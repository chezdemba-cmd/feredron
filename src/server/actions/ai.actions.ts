"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionOrgContext } from "./context";
import { runAction, formToObject } from "./runner";
import { Forbidden, NotFound } from "@/server/errors";
import { canAccessCustomer } from "@/server/crm/scope";
import { runInternalAssistant, type AssistantAnswer } from "@/server/ai/assistant-service";
import {
  approveOrderDraft,
  rejectOrderDraft,
} from "@/server/ai/order-draft-service";
import { approveProposal, rejectProposal } from "@/server/ai/proposal-service";
import {
  askAssistantSchema,
  orderDraftIdSchema,
  aiProposalIdSchema,
} from "@/server/validation/schemas";
import type { ActionResult } from "@/lib/result";

export async function askAssistantAction(
  _prev: ActionResult<AssistantAnswer> | null,
  formData: FormData,
): Promise<ActionResult<AssistantAnswer>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "ai.use",
      organizationId: raw.organizationId,
    });
    const { question, voiceOriginalText, voiceLanguage } = askAssistantSchema.parse(raw);

    return runInternalAssistant({
      organizationId: ctx.organization.id,
      organization: {
        name: ctx.organization.name,
        currency: ctx.organization.currency,
        timezone: ctx.organization.timezone,
      },
      user: { id: ctx.user.id, role: ctx.role },
      question,
      voiceCorrection:
        voiceOriginalText && voiceOriginalText !== question
          ? { originalText: voiceOriginalText, language: voiceLanguage }
          : undefined,
    });
  });
}

async function loadScopedDraft(
  organizationId: string,
  draftId: string,
  role: Role,
  userId: string,
) {
  const draft = await prisma.orderDraft.findFirst({
    where: { id: draftId, organizationId },
    select: {
      id: true,
      conversationId: true,
      customer: { select: { assignedToUserId: true } },
    },
  });
  if (!draft) throw NotFound("Brouillon introuvable dans cette entreprise.");
  if (draft.customer && !canAccessCustomer(role, userId, draft.customer)) {
    throw Forbidden("Ce brouillon ne relève pas de votre périmètre.");
  }
  return draft;
}

export async function approveOrderDraftAction(
  _prev: ActionResult<{ orderId: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ orderId: string; reference: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "orders.write",
      organizationId: raw.organizationId,
    });
    const { draftId } = orderDraftIdSchema.parse(raw);
    const draft = await loadScopedDraft(ctx.organization.id, draftId, ctx.role, ctx.user.id);

    const res = await approveOrderDraft({
      organizationId: ctx.organization.id,
      draftId: draft.id,
      actorUserId: ctx.user.id,
    });

    revalidatePath("/orders");
    revalidatePath("/conversations");
    if (draft.conversationId) revalidatePath(`/conversations/${draft.conversationId}`);
    return res;
  });
}

export async function rejectOrderDraftAction(
  _prev: ActionResult<{ ok: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "orders.write",
      organizationId: raw.organizationId,
    });
    const { draftId, reason } = orderDraftIdSchema.parse(raw);
    const draft = await loadScopedDraft(ctx.organization.id, draftId, ctx.role, ctx.user.id);

    await rejectOrderDraft({
      organizationId: ctx.organization.id,
      draftId: draft.id,
      actorUserId: ctx.user.id,
      reason: reason ?? null,
    });

    revalidatePath("/conversations");
    if (draft.conversationId) revalidatePath(`/conversations/${draft.conversationId}`);
    return { ok: true as const };
  });
}

export async function approveAiProposalAction(
  _prev: ActionResult<{ redirectTo?: string; summary: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ redirectTo?: string; summary: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    // Permission fine vérifiée dans approveProposal selon le type d'action.
    const ctx = await actionOrgContext({
      permission: "ai.use",
      organizationId: raw.organizationId,
    });
    const { proposalId } = aiProposalIdSchema.parse(raw);

    const res = await approveProposal({
      organizationId: ctx.organization.id,
      proposalId,
      actorUserId: ctx.user.id,
      role: ctx.role,
    });
    revalidatePath("/reminders");
    revalidatePath("/orders");
    revalidatePath("/marketing");
    return res;
  });
}

export async function rejectAiProposalAction(
  _prev: ActionResult<{ ok: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "ai.use",
      organizationId: raw.organizationId,
    });
    const { proposalId } = aiProposalIdSchema.parse(raw);
    await rejectProposal({
      organizationId: ctx.organization.id,
      proposalId,
      actorUserId: ctx.user.id,
    });
    return { ok: true as const };
  });
}
