"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { getEnv } from "@/lib/env";
import { actionOrgContext } from "./context";
import { runAction, formToObject } from "./runner";
import { Conflict, Forbidden, NotFound } from "@/server/errors";
import { canAccessConversation } from "@/server/whatsapp/scope";
import {
  correctTranscription,
  retranscribeMessage,
} from "@/server/voice/transcription-service";
import { getVoiceProvider } from "@/server/voice/provider";
import { detectVoiceLanguage } from "@/server/voice/language-detection";
import { languageCore } from "@/server/language/language-core-client";
import {
  correctTranscriptionSchema,
  retranscribeSchema,
} from "@/server/validation/schemas";
import type { ActionResult } from "@/lib/result";

async function loadScopedByMessage(
  organizationId: string,
  messageId: string,
  role: Parameters<typeof canAccessConversation>[0],
  userId: string,
) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, organizationId },
    select: {
      id: true,
      type: true,
      conversationId: true,
      conversation: {
        select: {
          id: true,
          assignedToUserId: true,
          customer: { select: { assignedToUserId: true } },
        },
      },
    },
  });
  if (!message) throw NotFound("Message introuvable dans cette entreprise.");
  if (message.type !== "AUDIO") throw Conflict("Ce message n'est pas un vocal.");
  if (!canAccessConversation(role, userId, message.conversation)) {
    throw Forbidden("Cette conversation ne relève pas de votre périmètre.");
  }
  return message;
}

export async function correctTranscriptionAction(
  _prev: ActionResult<{ effectiveText: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ effectiveText: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "conversations.write",
      organizationId: raw.organizationId,
    });
    const input = correctTranscriptionSchema.parse(raw);
    const message = await loadScopedByMessage(
      ctx.organization.id,
      input.messageId,
      ctx.role,
      ctx.user.id,
    );

    const res = await correctTranscription({
      organizationId: ctx.organization.id,
      messageId: message.id,
      correctedText: input.correctedText,
      actorUserId: ctx.user.id,
    });

    revalidatePath("/conversations");
    if (message.conversationId) {
      revalidatePath(`/conversations/${message.conversationId}`);
    }
    return res;
  });
}

export async function retranscribeTranscriptionAction(
  _prev: ActionResult<{ status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const raw = formToObject(formData);
    const ctx = await actionOrgContext({
      permission: "conversations.write",
      organizationId: raw.organizationId,
    });
    const input = retranscribeSchema.parse(raw);
    const message = await loadScopedByMessage(
      ctx.organization.id,
      input.messageId,
      ctx.role,
      ctx.user.id,
    );

    const res = await retranscribeMessage({
      organizationId: ctx.organization.id,
      messageId: message.id,
      actorUserId: ctx.user.id,
    });

    revalidatePath("/conversations");
    if (message.conversationId) {
      revalidatePath(`/conversations/${message.conversationId}`);
    }
    return res;
  });
}

/**
 * Enregistrement vocal DANS l'application (`/ai`). Éphémère : aucune ligne
 * `VoiceTranscription` (pas de `messageId`). Renvoie le texte pour que
 * l'utilisateur le vérifie avant de le soumettre à l'assistant.
 */
export async function transcribeAppAudioAction(
  _prev: ActionResult<{ text: string; language: string; confidence: number | null }> | null,
  formData: FormData,
): Promise<ActionResult<{ text: string; language: string; confidence: number | null }>> {
  return runAction(async () => {
    const ctx = await actionOrgContext({
      permission: "ai.use",
      organizationId: String(formData.get("organizationId") ?? ""),
    });

    const file = formData.get("audio");
    if (!(file instanceof File) || file.size === 0) {
      throw Conflict("Aucun audio reçu.");
    }
    const maxBytes = Math.round(getEnv().VOICE_MAX_FILE_MB * 1024 * 1024);
    if (file.size > maxBytes) throw Conflict("Enregistrement trop long.");

    const provider = getVoiceProvider();
    if (provider.name === "mock") {
      throw Conflict("La transcription vocale n’est pas encore configurée. Écrivez votre demande pour continuer.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await provider.transcribe({
      audio: bytes,
      mimeType: file.type || "audio/webm",
      languageHint: "fr,bm",
    });
    const { language } = detectVoiceLanguage({
      text: result.text,
      providerLanguage: result.detectedLanguage,
    });
    const text = result.text.trim();
    if (text) {
      // Matière brute pour le Language Core (§31) : ce canal est ÉPHÉMÈRE côté
      // métier (aucune VoiceTranscription), mais le texte transcrit lui-même
      // reste une observation utile pour le corpus BM/FR. Best-effort, en
      // arrière-plan. `resolvedMatchType: "NONE"` est REQUIS pour que
      // l'agrégateur du Learning Loop ramasse cette observation (il n'agrège
      // que les observations non résolues) — d'où la tentative de résolution
      // avant soumission, comme côté WhatsApp.
      void languageCore
        .resolveExpression({
          text,
          language: language === "BM" ? "BM" : language === "MIXED" ? "MIXED" : null,
          organizationId: ctx.organization.id,
        })
        .then((lc) => {
          if (!lc.matched) {
            void languageCore.submitObservation({
              originalText: text,
              detectedLanguage: language === "UNKNOWN" ? "OTHER" : language,
              organizationId: ctx.organization.id,
              resolvedMatchType: "NONE",
              contextType: "app-voice",
            });
          }
        });
    }
    return {
      text,
      language,
      confidence: result.confidence,
    };
  });
}
