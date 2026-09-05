import "server-only";
import { prisma } from "@/server/db/client";
import { getEnv } from "@/lib/env";
import { Conflict, Forbidden, NotFound } from "@/server/errors";
import { writeAuditLog } from "@/server/audit/log";
import { dispatchInboundAi } from "@/server/ai/dispatcher";
import { getVoiceProvider, VoiceTranscribeError } from "./provider";
import { downloadWhatsAppMedia, AudioDownloadError } from "./audio-service";
import {
  detectVoiceLanguage,
  normalizeVoiceText,
  type VoiceLang,
} from "./language-detection";
import { effectiveTextOf } from "./effective-text";
import { languageCore } from "@/server/language/language-core-client";
import { orgHasFeature } from "@/server/billing/guard";
import { checkUsageLimit, recordUsage } from "@/server/billing/usage-service";

/**
 * Cycle de vie d'une `VoiceTranscription`. Pipeline :
 *   AUDIO → (download) → TRANSCRIPTION → LANGUE → (si AUTO) Djeli IA
 * Aucune logique métier IA ici : on produit seulement du texte + une langue.
 */

export { effectiveTextOf } from "./effective-text";

export function getTranscriptionForMessage(
  organizationId: string,
  messageId: string,
) {
  return prisma.voiceTranscription.findFirst({
    where: { organizationId, messageId },
  });
}

type JobInput = {
  organizationId: string;
  conversationId: string;
  messageId: string;
};

export async function transcribeMessage(input: JobInput): Promise<void> {
  const message = await prisma.message.findFirst({
    where: { id: input.messageId, organizationId: input.organizationId },
    select: {
      id: true,
      direction: true,
      type: true,
      mediaId: true,
      mediaMimeType: true,
      conversationId: true,
    },
  });
  if (!message || message.direction !== "INBOUND" || message.type !== "AUDIO") {
    return;
  }

  // Idempotence (§33, §53) : une seule transcription active par message.
  const existing = await prisma.voiceTranscription.findUnique({
    where: { messageId: message.id },
    select: { id: true, status: true },
  });
  if (
    existing &&
    (existing.status === "COMPLETED" ||
      existing.status === "CORRECTED" ||
      existing.status === "PROCESSING")
  ) {
    return;
  }

  const provider = getVoiceProvider();
  const row = await prisma.voiceTranscription.upsert({
    where: { messageId: message.id },
    create: {
      organizationId: input.organizationId,
      messageId: message.id,
      conversationId: message.conversationId,
      provider: provider.name,
      model: provider.model,
      status: "PROCESSING",
      attempts: 1,
    },
    update: {
      status: "PROCESSING",
      errorCode: null,
      attempts: { increment: 1 },
      provider: provider.name,
      model: provider.model,
    },
    select: { id: true },
  });

  // Phase 8 — feature gating + plafond de transcription (§13, §20, §21).
  // Traitement asynchrone : on ne jette pas, on marque l'échec sans dépense.
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { timezone: true },
  });
  const tz = org?.timezone ?? "UTC";
  if (!(await orgHasFeature(input.organizationId, "VOICE"))) {
    await fail(row.id, input.organizationId, message.id, "FEATURE_LOCKED");
    return;
  }
  const voiceQuota = await checkUsageLimit(input.organizationId, "VOICE_SECONDS", {
    amount: 1,
    timeZone: tz,
  });
  if (!voiceQuota.allowed) {
    await fail(row.id, input.organizationId, message.id, "PLAN_LIMIT");
    return;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      mode: true,
      status: true,
      whatsappConnection: true,
    },
  });
  if (!conversation) {
    await fail(row.id, input.organizationId, message.id, "NO_CONVERSATION");
    return;
  }
  if (!message.mediaId) {
    await fail(row.id, input.organizationId, message.id, "NO_MEDIA_ID");
    return;
  }

  // ── Téléchargement (jamais persisté) ──
  let audio;
  try {
    audio = await downloadWhatsAppMedia({
      connection: conversation.whatsappConnection,
      mediaId: message.mediaId,
    });
  } catch (e) {
    const code = e instanceof AudioDownloadError ? e.code : "DOWNLOAD_ERROR";
    await fail(row.id, input.organizationId, message.id, code);
    return;
  }

  // ── Transcription ──
  let result;
  try {
    result = await provider.transcribe({
      audio: audio.bytes,
      mimeType: audio.mimeType || message.mediaMimeType || "audio/ogg",
      languageHint: "fr,bm",
    });
  } catch (e) {
    const code = e instanceof VoiceTranscribeError ? e.reason : "PROVIDER_ERROR";
    await fail(row.id, input.organizationId, message.id, code);
    return;
  }

  const original = (result.text ?? "").trim();
  const { language } = detectVoiceLanguage({
    text: original,
    providerLanguage: result.detectedLanguage,
  });
  const durationMs = result.durationMs ?? null;
  const audioSeconds = durationMs != null ? Math.round(durationMs / 1000) : 0;
  if (audioSeconds > 0) {
    await recordUsage(input.organizationId, "VOICE_SECONDS", audioSeconds, tz);
  }

  await prisma.voiceTranscription.update({
    where: { id: row.id },
    data: {
      status: "COMPLETED",
      originalText: original,
      effectiveText: original,
      normalizedText: normalizeVoiceText(original),
      detectedLanguage: language as VoiceLang,
      providerLanguage: result.detectedLanguage,
      confidence: result.confidence,
      durationMs,
      audioSeconds: durationMs != null ? Math.round(durationMs / 1000) : null,
      errorCode: null,
    },
  });

  await writeAuditLog({
    action: "VOICE_TRANSCRIPTION_COMPLETED",
    entityType: "voice_transcription",
    entityId: row.id,
    organizationId: input.organizationId,
    metadata: {
      messageId: message.id,
      language,
      confidence: result.confidence,
      durationMs,
      provider: provider.name,
      model: provider.model,
    },
  });

  // ── Enchaînement Djeli IA (§17) : comme pour un message texte ──
  if (conversation.mode === "AUTO" && conversation.status === "OPEN") {
    dispatchInboundAi({
      organizationId: input.organizationId,
      conversationId: conversation.id,
      messageId: message.id,
    });
  }
}

async function fail(
  transcriptionId: string,
  organizationId: string,
  messageId: string,
  code: string,
): Promise<void> {
  await prisma.voiceTranscription.update({
    where: { id: transcriptionId },
    data: { status: "FAILED", errorCode: code.slice(0, 60) },
  });
  await writeAuditLog({
    action: "VOICE_TRANSCRIPTION_FAILED",
    entityType: "voice_transcription",
    entityId: transcriptionId,
    organizationId,
    metadata: { messageId, code },
  });
}

// ─────────────────────── Actions humaines ───────────────────────

export async function retranscribeMessage(input: {
  organizationId: string;
  messageId: string;
  actorUserId: string;
}): Promise<{ status: string }> {
  const t = await prisma.voiceTranscription.findFirst({
    where: { organizationId: input.organizationId, messageId: input.messageId },
    select: { id: true, status: true, conversationId: true },
  });
  if (!t) throw NotFound("Aucune transcription pour ce message.");
  if (t.status === "CORRECTED") {
    throw Conflict("Cette transcription a été corrigée à la main — retranscription bloquée.");
  }
  await prisma.voiceTranscription.update({
    where: { id: t.id },
    data: { status: "PENDING", errorCode: null },
  });
  const conv = await prisma.message.findUnique({
    where: { id: input.messageId },
    select: { conversationId: true },
  });
  if (conv) {
    await transcribeMessage({
      organizationId: input.organizationId,
      conversationId: conv.conversationId,
      messageId: input.messageId,
    });
  }
  const fresh = await prisma.voiceTranscription.findUnique({
    where: { id: t.id },
    select: { status: true },
  });
  return { status: fresh?.status ?? "PENDING" };
}

export async function correctTranscription(input: {
  organizationId: string;
  messageId: string;
  correctedText: string;
  actorUserId: string;
}): Promise<{ effectiveText: string }> {
  const corrected = input.correctedText.trim();
  if (!corrected) throw Conflict("La correction ne peut pas être vide.");
  if (corrected.length > 4000) throw Conflict("Correction trop longue.");

  const t = await prisma.voiceTranscription.findFirst({
    where: { organizationId: input.organizationId, messageId: input.messageId },
    select: { id: true, status: true, originalText: true, detectedLanguage: true },
  });
  if (!t) throw NotFound("Aucune transcription à corriger pour ce message.");
  if (t.status === "PENDING" || t.status === "PROCESSING") {
    throw Conflict("Transcription encore en cours.");
  }

  await prisma.voiceTranscription.update({
    where: { id: t.id },
    data: {
      // `originalText` n'est JAMAIS écrasé (§14).
      correctedText: corrected,
      effectiveText: corrected,
      normalizedText: normalizeVoiceText(corrected),
      status: "CORRECTED",
      correctedByUserId: input.actorUserId,
      correctedAt: new Date(),
    },
  });

  await writeAuditLog({
    action: "VOICE_TRANSCRIPTION_CORRECTED",
    entityType: "voice_transcription",
    entityId: t.id,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    metadata: { messageId: input.messageId },
  });

  // Zone candidate du Djeli Language Core — jamais de promotion GLOBAL (§34, §55).
  // Best-effort : n'affecte pas le succès de la correction.
  void languageCore.submitCorrection({
    originalText: t.originalText,
    correctedText: corrected,
    detectedLanguage:
      t.detectedLanguage === "UNKNOWN" ? "OTHER" : t.detectedLanguage,
    organizationId: input.organizationId,
    context: "voice-transcription-correction",
    sourceReference: t.id, // chaîne opaque — le Core n'accède pas aux tables métier (§50)
    correctedByRef: `user:${input.actorUserId}`,
  });

  return { effectiveText: corrected };
}

/** Seuil de confiance sous lequel Djeli IA doit clarifier / faire un handoff. */
export function lowConfidenceThreshold(): number {
  return getEnv().VOICE_LOW_CONFIDENCE_THRESHOLD;
}
