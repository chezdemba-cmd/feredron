import "server-only";
import type { LanguageScope, Prisma } from "@prisma/client";
import { lcDb } from "../db";
import { Conflict, NotFound } from "@/server/errors";
import { normalizeText } from "../normalize";
import { lcAudit } from "../audit";
import {
  createEntry,
  addVariant,
  addTranslation,
  addIntentMapping,
} from "../entry-service";
import { detectEntryConflict } from "./conflict";
import {
  PROMOTION_TARGET_STATUS,
  assertPromotionStatus,
} from "./invariants";
import { assertScopeAccess, type ActorScope } from "../access";

/**
 * Promotion d'un candidat APPROVED → connaissance `SUGGESTED` (jamais
 * `VALIDATED`, §22/§63). Provenance complète. Conflit re-vérifié juste avant :
 * on ne fusionne JAMAIS automatiquement (§40).
 */
export async function promoteLearningCandidate(
  input: {
    candidateId: string;
    actorRef: string;
  },
  actor: ActorScope,
): Promise<{ entryId: string; variantId?: string; kind: string }> {
  const c = await lcDb.learningCandidate.findUnique({ where: { id: input.candidateId } });
  if (!c) throw NotFound("Candidat introuvable.");
  assertScopeAccess({ scope: c.scopeSuggestion, organizationId: c.organizationId }, actor);
  if (c.status === "PROMOTED" && c.promotedEntryId) {
    return { entryId: c.promotedEntryId, kind: "already" };
  }
  if (c.status !== "APPROVED") {
    throw Conflict("Seul un candidat APPROVED peut être promu.");
  }

  const scope: LanguageScope = c.scopeSuggestion;
  const domainCode = scope === "DOMAIN" ? c.domainCode : null;
  const organizationId = scope === "ORGANIZATION" ? c.organizationId : null;
  const canonicalNorm = normalizeText(c.canonicalText);

  const conflict = await detectEntryConflict({
    normalizedText: canonicalNorm,
    language: c.language,
    scope,
    domainCode,
    organizationId,
    proposedMeaning: c.proposedMeaning,
  });
  if (conflict.conflict) {
    await lcDb.learningCandidate.update({
      where: { id: c.id },
      data: { status: "CONFLICT", conflictEntryId: conflict.entryId },
    });
    throw Conflict("Conflit avec une entrée existante — promotion bloquée, revue manuelle requise.");
  }

  // Statut cible garanti par l'invariant (jamais VALIDATED / auto-GLOBAL).
  const targetStatus = PROMOTION_TARGET_STATUS;
  assertPromotionStatus(targetStatus);

  const provenance = {
    candidateId: c.id,
    evidenceCount: c.occurrenceCount,
    correctionCount: c.correctionCount,
    organizationCount: c.organizationCount,
    confidenceScore: c.confidenceScore,
    promotedAt: new Date().toISOString(),
  } satisfies Prisma.InputJsonValue;

  /** Retrouve (ou crée en SUGGESTED) l'entrée parente pour la forme canonique. */
  async function ensureParentEntry(): Promise<string> {
    const existing = await lcDb.languageEntry.findFirst({
      where: {
        normalizedText: canonicalNorm,
        language: c!.language,
        scope,
        domainCode,
        organizationId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await createEntry(
      {
        canonicalText: c!.canonicalText,
        language: c!.language,
        scope,
        domainCode,
        organizationId,
        meaning: c!.proposedMeaning ?? null,
        frenchTranslation:
          c!.proposedTranslationLang === "FR" ? c!.proposedTranslation ?? null : null,
        source: "BUSINESS_CORRECTION",
        status: targetStatus,
        createdByRef: input.actorRef,
        provenance,
      },
      actor,
    );
    return created.id;
  }

  let entryId: string;
  let variantId: string | undefined;
  let kind: string;

  if (c.candidateType === "NEW_ENTRY") {
    entryId = await ensureParentEntry();
    kind = "entry";
  } else if (c.candidateType === "VARIANT" || c.candidateType === "NORMALIZATION_PATTERN" || c.candidateType === "PRONUNCIATION_VARIANT") {
    entryId = await ensureParentEntry();
    const v = await addVariant(
      {
        entryId,
        text: c.originalPattern ?? c.canonicalText,
        variantType: c.candidateType === "NORMALIZATION_PATTERN" ? "SPELLING" : c.candidateType === "PRONUNCIATION_VARIANT" ? "PRONUNCIATION" : "SPELLING",
        notes: `Promu du candidat ${c.id}`,
        actorRef: input.actorRef,
      },
      actor,
    );
    variantId = v.id;
    kind = "variant";
  } else if (c.candidateType === "TRANSLATION") {
    entryId = await ensureParentEntry();
    await addTranslation(
      {
        entryId,
        language: c.proposedTranslationLang ?? "FR",
        text: c.proposedTranslation ?? c.canonicalText,
        source: "BUSINESS_CORRECTION",
        actorRef: input.actorRef,
      },
      actor,
    );
    kind = "translation";
  } else if (c.candidateType === "INTENT_MAPPING") {
    entryId = await ensureParentEntry();
    await addIntentMapping(
      {
        entryId,
        intentCode: c.proposedIntentCode ?? "UNKNOWN",
        domainCode,
        actorRef: input.actorRef,
      },
      actor,
    );
    kind = "intent";
  } else {
    entryId = await ensureParentEntry();
    kind = "entry";
  }

  await lcDb.learningCandidate.update({
    where: { id: c.id },
    data: {
      status: "PROMOTED",
      promotedEntryId: entryId,
      reviewedByRef: input.actorRef,
      reviewedAt: new Date(),
    },
  });
  await lcDb.learningReview.create({
    data: { candidateId: c.id, action: "PROMOTE", actorRef: input.actorRef },
  });
  await lcAudit({
    action: "LEARNING_CANDIDATE_PROMOTED",
    entityType: "learning_candidate",
    entityId: c.id,
    actorRef: input.actorRef,
    metadata: { entryId, kind, scope, targetStatus },
  });

  return { entryId, variantId, kind };
}
