"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionOrgContext } from "./context";
import { runAction, formToObject } from "./runner";
import { Conflict, Forbidden, NotFound } from "@/server/errors";
import { canAccessConversation, canAssignConversations } from "@/server/whatsapp/scope";
import {
  connectWhatsApp,
  disconnectWhatsApp,
} from "@/server/whatsapp/connection-service";
import { exchangeSignupCode } from "@/server/whatsapp/embedded-signup";
import { getEnv } from "@/lib/env";
import { sendConversationMessage } from "@/server/whatsapp/message-service";
import {
  assignConversation,
  setConversationMode,
  markConversationRead,
} from "@/server/whatsapp/conversation-service";
import {
  connectWhatsAppSchema,
  connectWhatsAppEmbeddedSchema,
  sendMessageSchema,
  assignConversationSchema,
  setConversationModeSchema,
  conversationIdSchema,
} from "@/server/validation/schemas";
import type { ActionResult } from "@/lib/result";

function revalidateConversation(id?: string) {
  revalidatePath("/conversations");
  if (id) revalidatePath(`/conversations/${id}`);
}

async function loadScopedConversation(
  organizationId: string,
  conversationId: string,
) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    select: {
      id: true,
      assignedToUserId: true,
      customer: { select: { assignedToUserId: true } },
    },
  });
  if (!conv) throw NotFound("Conversation introuvable dans cette entreprise.");
  return conv;
}

// ── Connexion WhatsApp (Paramètres) ──────────────────────────────────

export async function connectWhatsAppAction(
  _prev: ActionResult<{ connectionId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ connectionId: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "settings.update",
      organizationId: raw.organizationId,
    });
    const input = connectWhatsAppSchema.parse(raw);

    const res = await connectWhatsApp({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      provider: input.provider,
      phoneNumberId: input.phoneNumberId,
      businessAccountId: input.businessAccountId ?? null,
      displayPhoneNumber: input.displayPhoneNumber ?? null,
      verifiedName: input.verifiedName ?? null,
      accessToken: input.accessToken ?? "",
    });

    revalidatePath("/settings");
    revalidateConversation();
    return { connectionId: res.connectionId };
  });
}

/**
 * WhatsApp Embedded Signup : reçoit le code + les identifiants renvoyés par
 * le SDK Facebook Login for Business côté client, échange le code contre un
 * vrai token serveur-à-serveur (jamais côté client), puis enregistre la
 * connexion comme le formulaire manuel.
 */
export async function connectWhatsAppEmbeddedAction(
  _prev: ActionResult<{ connectionId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ connectionId: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "settings.update",
      organizationId: raw.organizationId,
    });
    const input = connectWhatsAppEmbeddedSchema.parse(raw);

    const env = getEnv();
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw Conflict("Embedded Signup non configuré côté serveur (META_APP_ID/META_APP_SECRET).");
    }

    const exchanged = await exchangeSignupCode({
      code: input.code,
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      graphVersion: env.META_GRAPH_API_VERSION,
    });
    if (!exchanged.ok) throw Conflict(exchanged.errorMessage);

    const res = await connectWhatsApp({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      provider: "META_CLOUD",
      phoneNumberId: input.phoneNumberId,
      businessAccountId: input.businessAccountId,
      accessToken: exchanged.accessToken,
    });

    revalidatePath("/settings");
    revalidateConversation();
    return { connectionId: res.connectionId };
  });
}

export async function disconnectWhatsAppAction(
  _prev: ActionResult<{ ok: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "settings.update",
      organizationId: raw.organizationId,
    });
    await disconnectWhatsApp({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
    });
    revalidatePath("/settings");
    revalidateConversation();
    return { ok: true as const };
  });
}

// ── Conversations ───────────────────────────────────────────────────

export async function sendMessageAction(
  _prev: ActionResult<{ messageId: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ messageId: string; status: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "conversations.write",
      organizationId: raw.organizationId,
    });
    const input = sendMessageSchema.parse(raw);

    const conv = await loadScopedConversation(
      ctx.organization.id,
      input.conversationId,
    );
    if (!canAccessConversation(ctx.role, ctx.user.id, conv)) {
      throw Forbidden("Cette conversation ne relève pas de votre périmètre.");
    }

    const res = await sendConversationMessage({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      conversationId: conv.id,
      body: input.body,
    });

    revalidateConversation(conv.id);
    return { messageId: res.messageId, status: res.status };
  });
}

export async function assignConversationAction(
  _prev: ActionResult<{ conversationId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ conversationId: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "conversations.write",
      organizationId: raw.organizationId,
    });
    const input = assignConversationSchema.parse(raw);

    if (!canAssignConversations(ctx.role)) {
      throw Forbidden("Seuls le propriétaire, un admin ou un gérant assignent une conversation.");
    }
    await loadScopedConversation(ctx.organization.id, input.conversationId);

    const res = await assignConversation({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      conversationId: input.conversationId,
      assigneeUserId: input.assigneeUserId ?? null,
    });
    revalidateConversation(res.conversationId);
    return res;
  });
}

export async function setConversationModeAction(
  _prev: ActionResult<{ conversationId: string; mode: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ conversationId: string; mode: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "conversations.write",
      organizationId: raw.organizationId,
    });
    const input = setConversationModeSchema.parse(raw);

    const conv = await loadScopedConversation(
      ctx.organization.id,
      input.conversationId,
    );
    if (!canAccessConversation(ctx.role, ctx.user.id, conv)) {
      throw Forbidden("Cette conversation ne relève pas de votre périmètre.");
    }

    const res = await setConversationMode({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      conversationId: conv.id,
      mode: input.mode,
    });
    revalidateConversation(conv.id);
    return res;
  });
}

export async function markConversationReadAction(
  _prev: ActionResult<{ ok: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "conversations.read",
      organizationId: raw.organizationId,
    });
    const input = conversationIdSchema.parse(raw);

    const conv = await loadScopedConversation(
      ctx.organization.id,
      input.conversationId,
    );
    if (!canAccessConversation(ctx.role, ctx.user.id, conv)) {
      throw Forbidden("Cette conversation ne relève pas de votre périmètre.");
    }
    await markConversationRead({
      organizationId: ctx.organization.id,
      conversationId: conv.id,
    });
    revalidateConversation(conv.id);
    return { ok: true as const };
  });
}
