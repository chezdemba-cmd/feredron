"use server";

import { revalidatePath } from "next/cache";
import type { LanguageCode } from "@prisma/client";
import { requireUserOrThrow } from "@/server/auth/current-user";
import { getOrgContext } from "@/server/tenant/context";
import { isSuperAdmin } from "@/server/admin/guard";
import { requirePermission } from "@/server/rbac/guard";
import type { Permission } from "@/server/rbac/permissions";
import { runAction, formToObject } from "./runner";
import { Forbidden } from "@/server/errors";
import type { ActorScope } from "@/language-core/access";
import { recomputeLearningCandidates } from "@/language-core/learning/aggregator";
import {
  approveCandidate,
  rejectCandidate,
  ignoreCandidate,
  editCandidateProposal,
} from "@/language-core/learning/review-service";
import { promoteLearningCandidate } from "@/language-core/learning/promotion-service";
import { buildLearningDataset, type DatasetFormat } from "@/language-core/learning/dataset-builder";
import { replayCandidate } from "@/language-core/learning/replay";
import type { ActionResult } from "@/lib/result";

async function actor(permission: Permission): Promise<{ actorRef: string; scope: ActorScope }> {
  const user = await requireUserOrThrow();
  const ctx = await getOrgContext(user);
  if (!ctx) throw Forbidden("Aucune organisation active.");
  requirePermission(ctx.role, permission);
  return {
    actorRef: `user:${user.id}`,
    scope: { organizationId: ctx.organization.id, isSuperAdmin: isSuperAdmin(user) },
  };
}

function rv(id?: string) {
  revalidatePath("/language");
  revalidatePath("/language/learning");
  if (id) revalidatePath(`/language/learning/${id}`);
}

export async function recomputeCandidatesAction(
  _p: ActionResult<{ created: number; updated: number; conflicts: number }> | null,
): Promise<ActionResult<{ created: number; updated: number; conflicts: number }>> {
  return runAction(async () => {
    const { actorRef } = await actor("language.review");
    const res = await recomputeLearningCandidates(actorRef);
    rv();
    return { created: res.candidatesCreated, updated: res.candidatesUpdated, conflicts: res.conflicts };
  });
}

export async function approveCandidateAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await actor("language.review");
    const raw = formToObject(formData);
    const c = await approveCandidate({ candidateId: raw.candidateId ?? "", actorRef, note: raw.note || null }, scope);
    rv(c.id);
    return { id: c.id };
  });
}

export async function rejectCandidateAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await actor("language.review");
    const raw = formToObject(formData);
    const c = await rejectCandidate({ candidateId: raw.candidateId ?? "", actorRef, reason: raw.reason || null }, scope);
    rv(c.id);
    return { id: c.id };
  });
}

export async function ignoreCandidateAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await actor("language.review");
    const raw = formToObject(formData);
    const c = await ignoreCandidate({ candidateId: raw.candidateId ?? "", actorRef }, scope);
    rv(c.id);
    return { id: c.id };
  });
}

export async function editCandidateAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await actor("language.review");
    const raw = formToObject(formData);
    const c = await editCandidateProposal(
      {
        candidateId: raw.candidateId ?? "",
        actorRef,
        patch: {
          ...(raw.canonicalText ? { canonicalText: raw.canonicalText } : {}),
          proposedMeaning: raw.proposedMeaning || null,
          proposedIntentCode: raw.proposedIntentCode || null,
          ...(raw.proposedTranslation
            ? {
                proposedTranslation: raw.proposedTranslation,
                proposedTranslationLang: (raw.proposedTranslationLang as LanguageCode) || "FR",
              }
            : {}),
        },
      },
      scope,
    );
    rv(c.id);
    return { id: c.id };
  });
}

export async function promoteCandidateAction(
  _p: ActionResult<{ entryId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ entryId: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await actor("language.review");
    const raw = formToObject(formData);
    const res = await promoteLearningCandidate({ candidateId: raw.candidateId ?? "", actorRef }, scope);
    rv(raw.candidateId);
    revalidatePath("/language/entries");
    revalidatePath("/language/suggestions");
    return { entryId: res.entryId };
  });
}

export async function exportLearningDatasetAction(
  _p: ActionResult<{ body: string; count: number; contentType: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ body: string; count: number; contentType: string }>> {
  return runAction(async () => {
    const { actorRef } = await actor("language.admin");
    const raw = formToObject(formData);
    const out = await buildLearningDataset(
      {
        format: (raw.format as DatasetFormat) || "jsonl",
        language: (raw.language as LanguageCode) || null,
        includeSplit: raw.includeSplit === "1",
      },
      actorRef,
    );
    return { body: out.body, count: out.count, contentType: out.contentType };
  });
}

export async function replayCandidateAction(
  _p: ActionResult<Awaited<ReturnType<typeof replayCandidate>>> | null,
  formData: FormData,
): Promise<ActionResult<Awaited<ReturnType<typeof replayCandidate>>>> {
  return runAction(async () => {
    await actor("language.review");
    const raw = formToObject(formData);
    const samples = (raw.samples ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return replayCandidate({ candidateId: raw.candidateId ?? "", samples });
  });
}
