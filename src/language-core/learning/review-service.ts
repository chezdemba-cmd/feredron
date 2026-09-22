import "server-only";
import type { LanguageCode } from "@prisma/client";
import { lcDb } from "../db";
import { Conflict, NotFound } from "@/server/errors";
import { lcAudit } from "../audit";
import { assertScopeAccess, type ActorScope } from "../access";

/**
 * Décisions humaines sur un candidat. Chaque décision est historisée
 * (`LearningReview`) et n'entraîne JAMAIS à elle seule une connaissance
 * VALIDATED (§1, §22, §63).
 */

async function load(candidateId: string, actor: ActorScope) {
  const c = await lcDb.learningCandidate.findUnique({ where: { id: candidateId } });
  if (!c) throw NotFound("Candidat introuvable.");
  assertScopeAccess({ scope: c.scopeSuggestion, organizationId: c.organizationId }, actor);
  return c;
}

async function logReview(input: {
  candidateId: string;
  action: "APPROVE" | "REJECT" | "IGNORE" | "EDIT" | "PROMOTE" | "MARK_USEFUL" | "MARK_WRONG";
  actorRef: string;
  note?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await lcDb.learningReview.create({
    data: {
      candidateId: input.candidateId,
      action: input.action,
      actorRef: input.actorRef,
      note: input.note ?? null,
      metadata: (input.metadata ?? undefined) as never,
    },
  });
}

export async function approveCandidate(
  input: {
    candidateId: string;
    actorRef: string;
    note?: string | null;
  },
  actor: ActorScope,
) {
  const c = await load(input.candidateId, actor);
  if (c.status === "PROMOTED") throw Conflict("Candidat déjà promu.");
  if (c.status === "CONFLICT") {
    throw Conflict("Candidat en conflit avec une entrée existante — résoudre le conflit d'abord.");
  }
  const updated = await lcDb.learningCandidate.update({
    where: { id: c.id },
    data: { status: "APPROVED", reviewedByRef: input.actorRef, reviewedAt: new Date() },
  });
  await logReview({ candidateId: c.id, action: "APPROVE", actorRef: input.actorRef, note: input.note });
  await lcAudit({
    action: "LEARNING_CANDIDATE_APPROVED",
    entityType: "learning_candidate",
    entityId: c.id,
    actorRef: input.actorRef,
    metadata: { scopeSuggestion: c.scopeSuggestion, type: c.candidateType },
  });
  return updated;
}

export async function rejectCandidate(
  input: {
    candidateId: string;
    actorRef: string;
    reason?: string | null;
  },
  actor: ActorScope,
) {
  const c = await load(input.candidateId, actor);
  if (c.status === "PROMOTED") throw Conflict("Candidat déjà promu.");
  const updated = await lcDb.learningCandidate.update({
    where: { id: c.id },
    data: {
      status: "REJECTED",
      reviewedByRef: input.actorRef,
      reviewedAt: new Date(),
      rejectionReason: input.reason ?? null,
    },
  });
  await logReview({ candidateId: c.id, action: "REJECT", actorRef: input.actorRef, note: input.reason });
  await lcAudit({
    action: "LEARNING_CANDIDATE_REJECTED",
    entityType: "learning_candidate",
    entityId: c.id,
    actorRef: input.actorRef,
    metadata: { reason: input.reason ?? null },
  });
  return updated;
}

export async function ignoreCandidate(
  input: { candidateId: string; actorRef: string },
  actor: ActorScope,
) {
  const c = await load(input.candidateId, actor);
  const updated = await lcDb.learningCandidate.update({
    where: { id: c.id },
    data: { status: "IGNORED", reviewedByRef: input.actorRef, reviewedAt: new Date() },
  });
  await logReview({ candidateId: c.id, action: "IGNORE", actorRef: input.actorRef });
  return updated;
}

/** « Modifier puis approuver » — ajuste la proposition avant approbation. */
export async function editCandidateProposal(
  input: {
    candidateId: string;
    actorRef: string;
    patch: Partial<{
      canonicalText: string;
      proposedMeaning: string | null;
      proposedTranslation: string | null;
      proposedTranslationLang: LanguageCode | null;
      proposedIntentCode: string | null;
    }>;
  },
  actor: ActorScope,
) {
  const c = await load(input.candidateId, actor);
  if (c.status === "PROMOTED") throw Conflict("Candidat déjà promu.");
  const updated = await lcDb.learningCandidate.update({
    where: { id: c.id },
    data: {
      ...(input.patch.canonicalText ? { canonicalText: input.patch.canonicalText } : {}),
      ...("proposedMeaning" in input.patch ? { proposedMeaning: input.patch.proposedMeaning } : {}),
      ...("proposedTranslation" in input.patch ? { proposedTranslation: input.patch.proposedTranslation } : {}),
      ...("proposedTranslationLang" in input.patch ? { proposedTranslationLang: input.patch.proposedTranslationLang } : {}),
      ...("proposedIntentCode" in input.patch ? { proposedIntentCode: input.patch.proposedIntentCode } : {}),
    },
  });
  await logReview({ candidateId: c.id, action: "EDIT", actorRef: input.actorRef, metadata: input.patch });
  await lcAudit({
    action: "LEARNING_CANDIDATE_UPDATED",
    entityType: "learning_candidate",
    entityId: c.id,
    actorRef: input.actorRef,
    metadata: { edited: Object.keys(input.patch) },
  });
  return updated;
}

export async function markCandidateUseful(
  input: { candidateId: string; actorRef: string },
  actor: ActorScope,
) {
  await load(input.candidateId, actor);
  await logReview({ candidateId: input.candidateId, action: "MARK_USEFUL", actorRef: input.actorRef });
}
export async function markCandidateWrong(
  input: { candidateId: string; actorRef: string; note?: string | null },
  actor: ActorScope,
) {
  await load(input.candidateId, actor);
  await logReview({ candidateId: input.candidateId, action: "MARK_WRONG", actorRef: input.actorRef, note: input.note });
}
