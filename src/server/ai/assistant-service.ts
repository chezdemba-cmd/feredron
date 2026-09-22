import "server-only";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logError } from "@/server/errors";
import { writeAuditLog } from "@/server/audit/log";
import { can } from "@/server/rbac/permissions";
import { customerScopeWhere } from "@/server/crm/scope";
import { buildSystemPrompt, AI_PROMPT_VERSION } from "./system-prompt";
import { getAiProvider } from "./provider";
import { claimAiRun, finishAiRun } from "./run-service";
import { runAiTurn } from "./turn";
import { normalizeConfidence } from "./confidence";
import { isAiIntent } from "./intents";
import type { CapabilityContext } from "./capabilities";
import { aiUsageGate, recordAiUsage } from "@/server/billing/ai-gate";
import { getStockSnapshots } from "@/server/stock/stock-service";
import { languageCore } from "@/server/language/language-core-client";

/**
 * Assistant interne `/ai` du commerçant. Les lectures s'exécutent directement
 * (avec les permissions du rôle). Les actions WRITE ne s'exécutent JAMAIS
 * seules : elles produisent une `AiActionProposal` à confirmer (§35).
 */

export type AssistantCard = { title: string; lines: string[] };

export type AssistantAnswer = {
  answer: string;
  intent: string;
  confidence: string;
  cards: AssistantCard[];
  handoffReason?: string;
  proposal?: { id: string; type: string; summary: string };
};

const REMINDER_RE =
  /(?:pr[ée]par(?:e|er)\s+)?(?:une\s+)?relanc(?:e|er)\s+(?:(?:pour|de|à)\s+)?(.+)/i;

const SALES_GOAL_RE =
  /(?:j['’]?ai\s+(?:encore\s+)?|vendre\s+)(\d+)\s+(.+?)(?:[.!?]|\s+(?:cette|dans|avant|d['’]ici)\b|$)/i;

export async function runInternalAssistant(input: {
  organizationId: string;
  organization: { name: string; currency: string; timezone: string };
  user: { id: string; role: Role };
  question: string;
  /** Présent si la question vient du micro et a été éditée avant envoi (§31). */
  voiceCorrection?: { originalText: string; language?: "FR" | "BM" | "MIXED" | "UNKNOWN" };
}): Promise<AssistantAnswer> {
  const question = input.question.trim().slice(0, 1000);

  if (input.voiceCorrection) {
    const lang = input.voiceCorrection.language;
    void languageCore.submitCorrection({
      originalText: input.voiceCorrection.originalText,
      correctedText: question,
      detectedLanguage: !lang || lang === "UNKNOWN" ? "OTHER" : lang,
      organizationId: input.organizationId,
      context: "internal-assistant-voice-correction",
      correctedByRef: `user:${input.user.id}`,
    });
  }

  // Phase 8 — feature gating + contrôle de coût fournisseur (§13, §20, §21).
  const gate = await aiUsageGate(input.organizationId, input.organization.timezone);
  if (!gate.ok) return card0(gate.message, "UNKNOWN", "MEDIUM");

  const claimed = await claimAiRun({
    organizationId: input.organizationId,
    automationType: "INTERNAL_ASSISTANT",
    userId: input.user.id,
    provider: getAiProvider().name,
    model: getAiProvider().model,
    promptVersion: AI_PROMPT_VERSION,
  });
  const aiRunId = claimed?.id ?? null;
  const startedAt = Date.now();

  try {
    // ── Objectif de vente → brouillon de campagne, après confirmation ──
    const salesMatch = question.match(SALES_GOAL_RE);
    if (salesMatch && can(input.user.role, "marketing.manage")) {
      const requestedQuantity = Number.parseInt(salesMatch[1]!, 10);
      const productQuery = salesMatch[2]!.trim();
      const terms = [productQuery, ...productQuery.split(/\s+/).filter((term) => term.length >= 4)];
      const matches = await prisma.product.findMany({
        where: {
          organizationId: input.organizationId,
          status: "ACTIVE",
          OR: terms.flatMap((term) => [
            { name: { contains: term, mode: "insensitive" as const } },
            { sku: { contains: term, mode: "insensitive" as const } },
          ]),
        },
        take: 4,
        select: { id: true, name: true, salePrice: true, alertThreshold: true, purchasePrice: true },
      });
      if (matches.length === 0) {
        await finish(aiRunId, "SUCCEEDED", "PRODUCT_SEARCH", startedAt);
        return card0(`Je ne trouve pas de produit correspondant à « ${productQuery} ».`, "PRODUCT_SEARCH", "MEDIUM");
      }
      if (matches.length > 1) {
        await finish(aiRunId, "SUCCEEDED", "PRODUCT_SEARCH", startedAt);
        return card0(
          `Plusieurs produits correspondent : ${matches.map((p) => p.name).join(", ")}. Précisez lequel.`,
          "PRODUCT_SEARCH",
          "MEDIUM",
        );
      }
      const product = matches[0]!;
      const snapshots = await getStockSnapshots(input.organizationId, [product]);
      const available = Math.max(0, snapshots.get(product.id)?.available ?? 0);
      if (available === 0) {
        await finish(aiRunId, "SUCCEEDED", "PRODUCT_AVAILABILITY", startedAt);
        return card0(`${product.name} n'a actuellement aucun stock disponible.`, "PRODUCT_AVAILABILITY", "HIGH");
      }
      const quantity = Math.min(requestedQuantity, available);
      const proposal = await prisma.aiActionProposal.create({
        data: {
          organizationId: input.organizationId,
          aiRunId,
          type: "PREPARE_SALES_CAMPAIGN",
          payload: { productId: product.id, requestedQuantity: quantity },
          summary: `Préparer une campagne pour vendre ${quantity} × ${product.name}`,
          status: "PENDING",
          createdByUserId: input.user.id,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
        select: { id: true },
      });
      await writeAuditLog({
        action: "AI_ACTION_PROPOSED",
        entityType: "ai_action_proposal",
        entityId: proposal.id,
        organizationId: input.organizationId,
        actorUserId: input.user.id,
        metadata: { type: "PREPARE_SALES_CAMPAIGN", productId: product.id, quantity },
      });
      await finish(aiRunId, "SUCCEEDED", "PRODUCT_AVAILABILITY", startedAt);
      void recordAiUsage(input.organizationId, input.organization.timezone, { input: 0, output: 0 });
      const price = new Intl.NumberFormat("fr-FR").format(Number(product.salePrice));
      return {
        answer: `Stock vérifié : ${available} ${product.name} disponible(s), à ${price} ${input.organization.currency}. Je peux préparer un brouillon WhatsApp destiné aux anciens acheteurs de ce produit. Confirmez pour le créer ; aucun message ne sera envoyé.`,
        intent: "PRODUCT_AVAILABILITY",
        confidence: "HIGH",
        cards: [{ title: "Plan de vente", lines: [`Objectif : ${quantity} article(s)`, "Canal : WhatsApp", "Audience : anciens acheteurs"] }],
        proposal: { id: proposal.id, type: "PREPARE_SALES_CAMPAIGN", summary: `Vendre ${quantity} × ${product.name}` },
      };
    }

    // ── Action WRITE : préparation de relance → proposition à confirmer ──
    const reminderMatch = question.match(REMINDER_RE);
    if (reminderMatch && can(input.user.role, "debts.write")) {
      const name = reminderMatch[1]!.trim().replace(/[?.!]+$/, "");
      const scope = customerScopeWhere(input.user.role, input.user.id);
      const matches = await prisma.customer.findMany({
        where: {
          organizationId: input.organizationId,
          ...scope,
          OR: [
            { displayName: { contains: name, mode: "insensitive" } },
            { businessName: { contains: name, mode: "insensitive" } },
          ],
        },
        take: 4,
        select: { id: true, displayName: true },
      });
      if (matches.length === 0) {
        await finish(aiRunId, "SUCCEEDED", "UNKNOWN", startedAt);
        return card0(`Je ne trouve pas de client « ${name} ».`, "UNKNOWN", "MEDIUM");
      }
      if (matches.length > 1) {
        await finish(aiRunId, "SUCCEEDED", "UNKNOWN", startedAt);
        return card0(
          `Plusieurs clients correspondent : ${matches.map((m) => m.displayName).join(", ")}. Précisez lequel.`,
          "UNKNOWN",
          "MEDIUM",
        );
      }
      const target = matches[0]!;
      const proposal = await prisma.aiActionProposal.create({
        data: {
          organizationId: input.organizationId,
          aiRunId: aiRunId,
          type: "PREPARE_REMINDER",
          payload: { customerId: target.id },
          summary: `Préparer une relance pour ${target.displayName}`,
          status: "PENDING",
          createdByUserId: input.user.id,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
        select: { id: true },
      });
      await writeAuditLog({
        action: "AI_ACTION_PROPOSED",
        entityType: "ai_action_proposal",
        entityId: proposal.id,
        organizationId: input.organizationId,
        actorUserId: input.user.id,
        metadata: { type: "PREPARE_REMINDER", customerId: target.id },
      });
      await finish(aiRunId, "SUCCEEDED", "UNKNOWN", startedAt);
      void recordAiUsage(input.organizationId, input.organization.timezone, { input: 0, output: 0 });
      return {
        answer: `Je peux préparer une relance pour ${target.displayName}. Confirmez pour générer la campagne (aucun envoi automatique).`,
        intent: "UNKNOWN",
        confidence: "HIGH",
        cards: [],
        proposal: {
          id: proposal.id,
          type: "PREPARE_REMINDER",
          summary: `Relance — ${target.displayName}`,
        },
      };
    }

    // Signal « no-match » pour le Learning Loop (§31, en écho au pipeline
    // WhatsApp) : n'affecte jamais la réponse, best-effort, en arrière-plan.
    void languageCore.resolveExpression({ text: question, organizationId: input.organizationId }).then((lc) => {
      if (!lc.matched && question.length >= 4 && question.length <= 300) {
        void languageCore.submitObservation({
          originalText: question,
          organizationId: input.organizationId,
          resolvedMatchType: "NONE",
          contextType: "internal-assistant",
        });
      }
    });

    // ── Lecture : raisonnement + tools ──
    const capCtx: CapabilityContext = {
      organizationId: input.organizationId,
      organization: {
        currency: input.organization.currency,
        timezone: input.organization.timezone,
        name: input.organization.name,
      },
      principal: { kind: "USER", userId: input.user.id, role: input.user.role },
    };
    const system = buildSystemPrompt({
      organizationName: input.organization.name,
      currency: input.organization.currency,
      timezone: input.organization.timezone,
      preferredLanguage: "FR",
      channel: "internal",
    });

    const outcome = await runAiTurn({
      capCtx,
      aiRunId: aiRunId ?? "internal",
      system,
      conversation: [{ role: "user", content: question }],
    });

    const plan = outcome.plan;
    const intent = isAiIntent(plan.intent) ? plan.intent : "UNKNOWN";
    const confidence = normalizeConfidence(plan.confidence);
    await finishAiRun2(aiRunId, {
      status: plan.handoff ? "HANDOFF" : "SUCCEEDED",
      intent,
      confidence,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      latencyMs: Date.now() - startedAt,
      handoffReason: plan.handoffReason ?? null,
    });
    await auditAssistant(input.organizationId, input.user.id, aiRunId, intent, outcome.toolNames);
    void recordAiUsage(input.organizationId, input.organization.timezone, {
      input: outcome.inputTokens,
      output: outcome.outputTokens,
    });

    return {
      answer:
        plan.reply.trim() ||
        (plan.handoff
          ? "Je préfère laisser un membre de l'équipe répondre à cette demande."
          : "Je n'ai pas trouvé d'information pour cette question."),
      intent,
      confidence,
      cards: buildCards(outcome.toolResults, input.organization.currency),
      ...(plan.handoff ? { handoffReason: plan.handoffReason ?? "Demande sensible ou ambiguë." } : {}),
    };
  } catch (error) {
    logError("ai.assistant", { error: error instanceof Error ? error.message : "unknown" });
    await finish(aiRunId, "FAILED", "UNKNOWN", startedAt);
    return card0(
      "Je n'ai pas pu traiter votre demande. Réessayez dans un instant.",
      "UNKNOWN",
      "LOW",
    );
  }
}

// ─────────────────────────── helpers ───────────────────────────

function card0(answer: string, intent: string, confidence: string): AssistantAnswer {
  return { answer, intent, confidence, cards: [] };
}

function money(n: unknown, currency: string): string {
  const label = currency === "XOF" || currency === "XAF" ? "FCFA" : currency;
  const v = typeof n === "number" ? n : 0;
  return `${String(Math.trunc(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${label}`;
}

function buildCards(
  results: Record<string, unknown>,
  currency: string,
): AssistantCard[] {
  const cards: AssistantCard[] = [];

  const debts = results.getDebtsOverview as
    | { totalOutstanding?: number; overdueOutstanding?: number; notDueOutstanding?: number; debtorCount?: number; orderCount?: number }
    | undefined;
  if (debts) {
    cards.push({
      title: "Créances",
      lines: [
        `Total dû : ${money(debts.totalOutstanding, currency)}`,
        `En retard : ${money(debts.overdueOutstanding, currency)}`,
        `À échoir : ${money(debts.notDueOutstanding, currency)}`,
        `${debts.debtorCount ?? 0} client(s) débiteur(s) · ${debts.orderCount ?? 0} commande(s)`,
      ],
    });
  }

  const sum = results.getBusinessDailySummary as
    | { salesToday?: number; ordersToday?: number; newCustomersToday?: number; cashCollectedToday?: number }
    | undefined;
  if (sum) {
    const lines = [
      `Ventes livrées : ${money(sum.salesToday, currency)}`,
      `Commandes créées : ${sum.ordersToday ?? 0}`,
      `Nouveaux clients : ${sum.newCustomersToday ?? 0}`,
    ];
    if (typeof sum.cashCollectedToday === "number") {
      lines.splice(1, 0, `Encaissé : ${money(sum.cashCollectedToday, currency)}`);
    }
    cards.push({ title: "Aujourd'hui", lines });
  }

  const fin = results.getCustomerFinancialSummary as
    | {
        found?: boolean;
        customerName?: string;
        totalOutstanding?: number;
        overdueOutstanding?: number;
        totalPurchased?: number;
        totalPaid?: number;
      }
    | undefined;
  if (fin && fin.found !== false) {
    cards.push({
      title: fin.customerName ?? "Client",
      lines: [
        `Solde dû : ${money(fin.totalOutstanding, currency)}`,
        `En retard : ${money(fin.overdueOutstanding, currency)}`,
        `Total acheté : ${money(fin.totalPurchased, currency)}`,
        `Total payé : ${money(fin.totalPaid, currency)}`,
      ],
    });
  }

  const prods = results.searchProducts as
    | { matches?: Array<{ name: string; sku: string; salePrice: number; available: number }> }
    | undefined;
  if (prods?.matches?.length) {
    cards.push({
      title: "Produits",
      lines: prods.matches.map(
        (p) => `${p.name} (${p.sku}) — ${money(p.salePrice, currency)} · ${p.available} dispo`,
      ),
    });
  }

  return cards;
}

async function finish(
  aiRunId: string | null,
  status: "SUCCEEDED" | "FAILED" | "HANDOFF",
  intent: string,
  startedAt: number,
): Promise<void> {
  if (!aiRunId) return;
  await finishAiRun(aiRunId, {
    status,
    intent,
    latencyMs: Date.now() - startedAt,
  });
}

async function finishAiRun2(
  aiRunId: string | null,
  data: Parameters<typeof finishAiRun>[1],
): Promise<void> {
  if (!aiRunId) return;
  await finishAiRun(aiRunId, data);
}

async function auditAssistant(
  organizationId: string,
  userId: string,
  aiRunId: string | null,
  intent: string,
  tools: string[],
): Promise<void> {
  await writeAuditLog({
    action: "AI_RUN_COMPLETED",
    entityType: "ai_run",
    entityId: aiRunId ?? undefined,
    organizationId,
    actorUserId: userId,
    metadata: { channel: "internal", intent, tools },
  });
}
