import "server-only";
import { prisma } from "@/server/db/client";
import { logError } from "@/server/errors";
import { getEnv } from "@/lib/env";
import { writeAuditLog } from "@/server/audit/log";
import { rateLimit } from "@/server/whatsapp/rate-limit";
import { isCustomerServiceWindowOpen } from "@/server/whatsapp/service-window";
import { sendAiConversationMessage } from "@/server/whatsapp/message-service";
import { buildSystemPrompt, AI_PROMPT_VERSION } from "./system-prompt";
import { getAiProvider, type AiMessage } from "./provider";
import { claimAiRun, finishAiRun } from "./run-service";
import { runAiTurn } from "./turn";
import { decidePolicy, normalizeConfidence } from "./confidence";
import { normalizeLanguage } from "./language";
import { isAiIntent } from "./intents";
import {
  createOrderDraftForConversation,
  getActiveDraftForConversation,
  markDraftCustomerConfirmed,
} from "./order-draft-service";
import {
  getTranscriptionForMessage,
  lowConfidenceThreshold,
} from "@/server/voice/transcription-service";
import { languageCore } from "@/server/language/language-core-client";
import { orgHasFeature } from "@/server/billing/guard";
import { checkUsageLimit, recordUsage } from "@/server/billing/usage-service";
import type { CapabilityContext } from "./capabilities";

const CONFIRM_RE = /^\s*(oui|ok|d'accord|d accord|je confirme|c'est bon|c est bon|oui merci|d'ac)\b/i;
const HISTORY_LIMIT = 12;

export type InboundAiInput = {
  organizationId: string;
  conversationId: string;
  messageId: string;
};

/**
 * Pipeline de réponse AUTO. Exécuté APRÈS la réponse 200 au webhook (jamais
 * dans la requête Meta). Toutes les gardes échouent « silencieusement »
 * (aucune réponse) plutôt que de risquer une action non désirée.
 */
export async function handleInboundForAi(input: InboundAiInput): Promise<void> {
  try {
    await run(input);
  } catch (error) {
    logError("ai.whatsapp.handleInbound", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function run(input: InboundAiInput): Promise<void> {
  const message = await prisma.message.findFirst({
    where: { id: input.messageId, organizationId: input.organizationId },
    select: { id: true, direction: true, type: true, body: true, conversationId: true },
  });
  if (!message || message.direction !== "INBOUND") return; // §62 : seul l'INBOUND client déclenche

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    include: {
      whatsappConnection: { select: { status: true } },
      customer: { select: { id: true } },
      organization: { select: { name: true, currency: true, timezone: true } },
    },
  });
  if (!conversation) return;

  // ── Gardes (§10) ──
  if (conversation.mode !== "AUTO") return; // HUMAN / PAUSED : aucun AiRun
  if (conversation.status !== "OPEN") return;
  if (conversation.whatsappConnection.status !== "CONNECTED") return;

  // ── Phase 8 : feature gating + quota (§13, §20, §21) ──
  // Pas de réponse AUTO si l'offre n'inclut pas l'IA ou si le quota est atteint.
  if (!(await orgHasFeature(input.organizationId, "AI"))) return;
  const aiQuota = await checkUsageLimit(input.organizationId, "AI_REQUESTS", {
    timeZone: conversation.organization.timezone,
  });
  if (!aiQuota.allowed) return;

  // ── Idempotence (§50, §73) : un seul AiRun automatique par message ──
  // Réclamé AVANT le rate-limit pour qu'un rejeu Meta ne consomme pas de jeton.
  const claimed = await claimAiRun({
    organizationId: input.organizationId,
    automationType: "WHATSAPP_AUTO_REPLY",
    conversationId: conversation.id,
    messageId: message.id,
    userId: null,
    provider: getAiProvider().name,
    model: getAiProvider().model,
    promptVersion: AI_PROMPT_VERSION,
  });
  if (!claimed) return; // déjà traité
  const aiRunId = claimed.id;
  const startedAt = Date.now();
  void recordUsage(input.organizationId, "AI_REQUESTS", 1, conversation.organization.timezone);

  const windowOpen = isCustomerServiceWindowOpen(conversation.lastInboundAt);

  // ── Djeli Voice : pour un message vocal, on travaille sur la transcription ──
  let effectiveBody = message.type === "TEXT" ? message.body ?? "" : "";
  let voiceLanguage: "FR" | "BM" | "MIXED" | "UNKNOWN" | null = null;
  if (message.type === "AUDIO") {
    const t = await getTranscriptionForMessage(input.organizationId, message.id);
    if (!t || (t.status !== "COMPLETED" && t.status !== "CORRECTED")) {
      await handoff(aiRunId, conversation.id, conversation.customer?.id ?? null, {
        reason: "Transcription vocale indisponible — traitement humain.",
        windowOpen,
        startedAt,
        replyIfOpen:
          "J'ai bien reçu votre message vocal. Un membre de l'équipe va vous répondre.",
        errorCode: "VOICE_UNAVAILABLE",
      });
      return;
    }
    effectiveBody = t.effectiveText.trim();
    voiceLanguage = t.detectedLanguage;
    // Confiance basse → clarification / handoff, JAMAIS d'action sensible (§20, §52).
    // Kooma ne renvoie aucun score de confiance (confidence toujours null) ;
    // vu la précision mesurée en conditions réelles (~70%, cf. mémoire projet),
    // une confiance INCONNUE pour ce provider est traitée comme BASSE plutôt
    // que comme fiable par défaut.
    const lowConfidence =
      (t.confidence != null && t.confidence < lowConfidenceThreshold()) ||
      (t.confidence == null && t.provider === "kooma");
    if (lowConfidence) {
      await handoff(aiRunId, conversation.id, conversation.customer?.id ?? null, {
        reason:
          t.confidence != null
            ? `Transcription vocale peu fiable (confiance ${t.confidence.toFixed(2)}).`
            : "Transcription vocale sans score de confiance (provider Kooma) — clarification systématique.",
        windowOpen,
        startedAt,
        replyIfOpen:
          "Je n'ai pas bien compris votre message vocal. Pouvez-vous le répéter ou l'écrire ? Un membre de l'équipe peut aussi vous aider.",
        intent: "UNKNOWN",
        confidence: "LOW",
      });
      return;
    }
    if (!effectiveBody) {
      await handoff(aiRunId, conversation.id, conversation.customer?.id ?? null, {
        reason: "Transcription vocale vide.",
        windowOpen,
        startedAt,
        replyIfOpen: "Un membre de l'équipe va reprendre votre demande.",
      });
      return;
    }
  }

  // ── Anti-boucle : trop de réponses AUTO récentes → handoff ──
  const rl = rateLimit(
    `ai-auto:${conversation.id}`,
    getEnv().AI_AUTO_MAX_PER_MIN,
    60_000,
  );
  if (!rl.allowed) {
    await handoff(aiRunId, conversation.id, conversation.customer?.id ?? null, {
      reason: "Trop de réponses automatiques — reprise humaine.",
      windowOpen,
      startedAt,
    });
    return;
  }

  // ── Raccourci : confirmation d'un brouillon en attente ──
  const activeDraft = await getActiveDraftForConversation(
    input.organizationId,
    conversation.id,
  );
  if (
    activeDraft &&
    activeDraft.status === "AWAITING_CUSTOMER_CONFIRMATION" &&
    effectiveBody &&
    CONFIRM_RE.test(effectiveBody)
  ) {
    await markDraftCustomerConfirmed(input.organizationId, activeDraft.id);
    if (windowOpen) {
      await sendAiConversationMessage({
        organizationId: input.organizationId,
        conversationId: conversation.id,
        body: "Merci ! Votre commande est transmise à l'équipe pour validation. Vous recevrez une confirmation.",
        aiRunId,
      });
    }
    await finishAiRun(aiRunId, {
      status: "SUCCEEDED",
      intent: "ORDER_REQUEST",
      confidence: "HIGH",
      latencyMs: Date.now() - startedAt,
    });
    await auditRun(input.organizationId, aiRunId, "SUCCEEDED", "ORDER_REQUEST", []);
    return;
  }

  // ── Message non textuel non vocal (image, document…) → handoff ──
  if (message.type !== "TEXT" && message.type !== "AUDIO") {
    await handoff(aiRunId, conversation.id, conversation.customer?.id ?? null, {
      reason: "Message non textuel — traitement humain.",
      windowOpen,
      startedAt,
      replyIfOpen:
        "J'ai bien reçu votre message. Un membre de l'équipe va vous répondre.",
    });
    return;
  }
  if (!effectiveBody) return;

  // ── Raisonnement + outils ──
  const capCtx: CapabilityContext = {
    organizationId: input.organizationId,
    organization: {
      currency: conversation.organization.currency,
      timezone: conversation.organization.timezone,
      name: conversation.organization.name,
    },
    principal: {
      kind: "SYSTEM_AI",
      conversationCustomerId: conversation.customer?.id ?? null,
    },
  };

  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id, id: { not: message.id } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, body: true, type: true },
  });
  const convMessages: AiMessage[] = history
    .reverse()
    .map((m) => ({
      role: m.direction === "INBOUND" ? ("user" as const) : ("assistant" as const),
      content:
        m.type === "TEXT" && m.body ? m.body : `[${m.type.toLowerCase()}]`,
    }));
  // Le message courant (texte OU transcription vocale) comme dernier tour client.
  convMessages.push({ role: "user", content: effectiveBody });

  // Enrichissement OPTIONNEL par Djeli Language Core (§31, §32). Best-effort :
  // si le Core est indisponible, `resolveExpression` renvoie un résultat neutre.
  const lc = await languageCore.resolveExpression({
    text: effectiveBody,
    language:
      voiceLanguage === "BM" ? "BM" : voiceLanguage === "MIXED" ? "MIXED" : null,
    organizationId: input.organizationId,
  });
  if (lc.matched && lc.canonicalText) {
    const hintParts = [`expression reconnue « ${lc.canonicalText} »`];
    if (lc.meaning) hintParts.push(`sens : ${lc.meaning}`);
    if (lc.intentMappings[0]) hintParts.push(`intention possible : ${lc.intentMappings[0].intentCode}`);
    convMessages.push({
      role: "user",
      content: `[CONTEXTE LANGUE] ${hintParts.join(" ; ")}. (Indice non contraignant.)`,
    });
  } else if (!lc.matched && effectiveBody.length >= 4 && effectiveBody.length <= 300) {
    // Signal « no-match » → nourrit le Learning Loop (§13). Best-effort, dédupé
    // par (application + organisation + messageId).
    void languageCore.submitObservation({
      originalText: effectiveBody,
      detectedLanguage:
        voiceLanguage === "BM" ? "BM" : voiceLanguage === "MIXED" ? "MIXED" : undefined,
      organizationId: input.organizationId,
      resolvedMatchType: "NONE",
      contextType: message.type === "AUDIO" ? "voice" : "chat",
      sourceReference: message.id,
    });
  }

  const system = buildSystemPrompt({
    organizationName: conversation.organization.name,
    currency: conversation.organization.currency,
    timezone: conversation.organization.timezone,
    preferredLanguage:
      voiceLanguage === "BM" ? "BM" : voiceLanguage === "MIXED" ? "AUTO" : "AUTO",
    channel: "whatsapp",
  });

  let outcome;
  try {
    outcome = await runAiTurn({ capCtx, aiRunId, system, conversation: convMessages });
  } catch (error) {
    logError("ai.whatsapp.turn", { conversationId: conversation.id, error: String(error) });
    await handoff(aiRunId, conversation.id, conversation.customer?.id ?? null, {
      reason: "Erreur ou délai du modèle.",
      windowOpen,
      startedAt,
      replyIfOpen: "Un membre de l'équipe va reprendre votre demande.",
      errorCode: "PROVIDER_ERROR",
    });
    return;
  }

  const plan = outcome.plan;
  const confidence = normalizeConfidence(plan.confidence);
  const intent = isAiIntent(plan.intent) ? plan.intent : "UNKNOWN";
  const policy = decidePolicy({
    confidence,
    intent,
    explicitHandoff: plan.handoff,
    nonTextInbound: false,
    serviceWindowOpen: windowOpen,
  });

  if (policy.handoff) {
    await handoff(aiRunId, conversation.id, conversation.customer?.id ?? null, {
      reason: plan.handoffReason ?? policy.reason,
      windowOpen,
      startedAt,
      replyIfOpen:
        plan.reply || "Un membre de l'équipe va reprendre votre demande.",
      intent,
      confidence,
      language: normalizeLanguage(plan.language),
      toolNames: outcome.toolNames,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
    });
    return;
  }

  // ── Brouillon de commande (jamais d'Order, jamais de réservation) ──
  if (plan.orderDraft && policy.allowDraft && conversation.customer?.id) {
    try {
      await createOrderDraftForConversation({
        organizationId: input.organizationId,
        conversationId: conversation.id,
        customerId: conversation.customer.id,
        sourceMessageId: message.id,
        lines: plan.orderDraft.lines,
        notes: plan.orderDraft.notes ?? null,
        aiRunId,
      });
    } catch (error) {
      logError("ai.whatsapp.draft", { error: String(error) });
    }
  }

  // ── Réponse automatique ──
  const reply = plan.reply.trim();
  if (policy.autoReply && reply && windowOpen) {
    await sendAiConversationMessage({
      organizationId: input.organizationId,
      conversationId: conversation.id,
      body: reply,
      aiRunId,
    });
  }

  await finishAiRun(aiRunId, {
    status: "SUCCEEDED",
    intent,
    language: normalizeLanguage(plan.language),
    confidence,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    latencyMs: Date.now() - startedAt,
  });
  await auditRun(input.organizationId, aiRunId, "SUCCEEDED", intent, outcome.toolNames);
}

// ─────────────────────────── helpers ───────────────────────────

async function handoff(
  aiRunId: string,
  conversationId: string,
  customerId: string | null,
  opts: {
    reason: string;
    windowOpen: boolean;
    startedAt: number;
    replyIfOpen?: string;
    intent?: string;
    confidence?: "LOW" | "MEDIUM" | "HIGH";
    language?: string;
    toolNames?: string[];
    inputTokens?: number | null;
    outputTokens?: number | null;
    errorCode?: string;
  },
): Promise<void> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { organizationId: true, mode: true },
  });
  if (!conv) return;

  if (conv.mode === "AUTO") {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { mode: "HUMAN" },
    });
  }
  if (customerId) {
    await prisma.customerActivity.create({
      data: {
        organizationId: conv.organizationId,
        customerId,
        type: "AI_HANDOFF",
        title: `Djeli IA demande une intervention humaine : ${opts.reason}`,
        metadata: { conversationId, aiRunId },
      },
    });
  }
  if (opts.replyIfOpen && opts.windowOpen) {
    try {
      await sendAiConversationMessage({
        organizationId: conv.organizationId,
        conversationId,
        body: opts.replyIfOpen,
        aiRunId,
      });
    } catch {
      /* non bloquant */
    }
  }

  await finishAiRun(aiRunId, {
    status: "HANDOFF",
    intent: opts.intent ?? null,
    language: opts.language ?? null,
    confidence: opts.confidence ?? null,
    handoffReason: opts.reason,
    inputTokens: opts.inputTokens ?? null,
    outputTokens: opts.outputTokens ?? null,
    latencyMs: Date.now() - opts.startedAt,
    errorCode: opts.errorCode ?? null,
  });

  await writeAuditLog({
    action: "AI_HANDOFF",
    entityType: "conversation",
    entityId: conversationId,
    organizationId: conv.organizationId,
    metadata: { aiRunId, reason: opts.reason },
  });
}

async function auditRun(
  organizationId: string,
  aiRunId: string,
  status: string,
  intent: string,
  toolNames: string[],
): Promise<void> {
  await writeAuditLog({
    action: "AI_RUN_COMPLETED",
    entityType: "ai_run",
    entityId: aiRunId,
    organizationId,
    metadata: { status, intent, tools: toolNames },
  });
}
