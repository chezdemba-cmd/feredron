import "server-only";
import type {
  LanguageCode,
  LanguageEntryStatus,
  LanguageScope,
  LanguageSource,
  LanguageVariantType,
  Prisma,
} from "@prisma/client";
import { lcDb } from "./db";
import { Conflict, NotFound } from "@/server/errors";
import { normalizeText } from "./normalize";
import { lcAudit } from "./audit";
import { assertScopeAccess, resolveOwnedOrganizationId, type ActorScope } from "./access";

/**
 * Cycle de vie d'une `LanguageEntry` : création (par défaut SUGGESTED), édition,
 * validation, rejet, archivage — chaque changement d'une entrée VALIDATED est
 * tracé dans `LanguageEntryRevision`.
 */

export type CreateEntryInput = {
  canonicalText: string;
  language: LanguageCode;
  scope: LanguageScope;
  domainCode?: string | null;
  organizationId?: string | null;
  meaning?: string | null;
  frenchTranslation?: string | null;
  englishTranslation?: string | null;
  source?: LanguageSource;
  confidence?: number | null;
  createdByRef?: string | null;
  provenance?: Record<string, unknown> | null;
  /** OBSERVED / SUGGESTED seulement — VALIDATED passe par validateEntry. */
  status?: Extract<LanguageEntryStatus, "OBSERVED" | "SUGGESTED">;
};

function assertScopeShape(input: {
  scope: LanguageScope;
  domainCode?: string | null;
  organizationId?: string | null;
}) {
  if (input.scope === "ORGANIZATION" && !input.organizationId) {
    throw Conflict("Une entrée ORGANIZATION exige un organizationId.");
  }
  if (input.scope === "DOMAIN" && !input.domainCode) {
    throw Conflict("Une entrée DOMAIN exige un domainCode.");
  }
  if (input.scope === "GLOBAL" && (input.organizationId || input.domainCode)) {
    throw Conflict("Une entrée GLOBAL ne porte ni organizationId ni domainCode.");
  }
}

export async function createEntry(input: CreateEntryInput, actor: ActorScope) {
  assertScopeShape(input);
  // Un appelant non-superadmin ne peut jamais créer une entrée ORGANIZATION
  // pour une autre organisation que la sienne — la valeur reçue du client
  // (formulaire) n'est jamais celle qui compte pour ce scope.
  const organizationId = resolveOwnedOrganizationId(
    input.scope,
    input.organizationId ?? null,
    actor,
  );
  const normalizedText = normalizeText(input.canonicalText);
  if (!normalizedText) throw Conflict("Texte vide.");

  const dupe = await lcDb.languageEntry.findFirst({
    where: {
      normalizedText,
      language: input.language,
      scope: input.scope,
      domainCode: input.domainCode ?? null,
      organizationId,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (dupe) throw Conflict("Une entrée équivalente existe déjà.");

  const entry = await lcDb.languageEntry.create({
    data: {
      canonicalText: input.canonicalText.trim(),
      normalizedText,
      language: input.language,
      scope: input.scope,
      domainCode: input.domainCode ?? null,
      organizationId,
      meaning: input.meaning ?? null,
      frenchTranslation: input.frenchTranslation ?? null,
      englishTranslation: input.englishTranslation ?? null,
      source: input.source ?? "HUMAN",
      confidence: input.confidence ?? null,
      createdByRef: input.createdByRef ?? null,
      provenance: (input.provenance ?? undefined) as Prisma.InputJsonValue | undefined,
      status: input.status ?? "SUGGESTED",
      version: 1,
    },
  });
  await snapshot(entry.id, "création", input.createdByRef ?? null);
  await lcAudit({
    action: "LANGUAGE_ENTRY_CREATED",
    entityType: "language_entry",
    entityId: entry.id,
    actorRef: input.createdByRef ?? null,
    metadata: { scope: entry.scope, language: entry.language, status: entry.status },
  });
  return entry;
}

export type UpdateEntryInput = {
  entryId: string;
  actorRef?: string | null;
  changeReason?: string | null;
  patch: Partial<{
    canonicalText: string;
    meaning: string | null;
    frenchTranslation: string | null;
    englishTranslation: string | null;
    confidence: number | null;
  }>;
};

export async function updateEntry(input: UpdateEntryInput, actor: ActorScope) {
  const entry = await lcDb.languageEntry.findUnique({ where: { id: input.entryId } });
  if (!entry) throw NotFound("Entrée introuvable.");
  assertScopeAccess(entry, actor);
  if (entry.archivedAt) throw Conflict("Entrée archivée.");

  const data: Prisma.LanguageEntryUpdateInput = {};
  if (input.patch.canonicalText != null) {
    data.canonicalText = input.patch.canonicalText.trim();
    data.normalizedText = normalizeText(input.patch.canonicalText);
  }
  if ("meaning" in input.patch) data.meaning = input.patch.meaning ?? null;
  if ("frenchTranslation" in input.patch) data.frenchTranslation = input.patch.frenchTranslation ?? null;
  if ("englishTranslation" in input.patch) data.englishTranslation = input.patch.englishTranslation ?? null;
  if ("confidence" in input.patch) data.confidence = input.patch.confidence ?? null;
  data.version = { increment: 1 };

  const updated = await lcDb.languageEntry.update({ where: { id: entry.id }, data });
  await snapshot(entry.id, input.changeReason ?? "mise à jour", input.actorRef ?? null);
  await lcAudit({
    action: "LANGUAGE_ENTRY_UPDATED",
    entityType: "language_entry",
    entityId: entry.id,
    actorRef: input.actorRef ?? null,
    metadata: { version: updated.version, fromStatus: entry.status },
  });
  return updated;
}

export async function validateEntry(
  input: {
    entryId: string;
    actorRef: string;
  },
  actor: ActorScope,
) {
  const entry = await lcDb.languageEntry.findUnique({ where: { id: input.entryId } });
  if (!entry) throw NotFound("Entrée introuvable.");
  assertScopeAccess(entry, actor);
  if (entry.status === "VALIDATED") return entry;
  if (entry.status === "REJECTED" || entry.status === "ARCHIVED") {
    throw Conflict("Impossible de valider une entrée rejetée ou archivée.");
  }
  const updated = await lcDb.languageEntry.update({
    where: { id: entry.id },
    data: {
      status: "VALIDATED",
      validatedByRef: input.actorRef,
      validatedAt: new Date(),
      version: { increment: 1 },
    },
  });
  await snapshot(entry.id, "validation", input.actorRef);
  await lcAudit({
    action: "LANGUAGE_ENTRY_VALIDATED",
    entityType: "language_entry",
    entityId: entry.id,
    actorRef: input.actorRef,
    metadata: { scope: entry.scope, version: updated.version },
  });
  return updated;
}

export async function rejectEntry(
  input: {
    entryId: string;
    actorRef: string;
    reason?: string | null;
  },
  actor: ActorScope,
) {
  const entry = await lcDb.languageEntry.findUnique({ where: { id: input.entryId } });
  if (!entry) throw NotFound("Entrée introuvable.");
  assertScopeAccess(entry, actor);
  const updated = await lcDb.languageEntry.update({
    where: { id: entry.id },
    data: { status: "REJECTED", version: { increment: 1 } },
  });
  await snapshot(entry.id, input.reason ?? "rejet", input.actorRef);
  await lcAudit({
    action: "LANGUAGE_ENTRY_REJECTED",
    entityType: "language_entry",
    entityId: entry.id,
    actorRef: input.actorRef,
    metadata: { reason: input.reason ?? null },
  });
  return updated;
}

export async function archiveEntry(
  input: { entryId: string; actorRef: string },
  actor: ActorScope,
) {
  const entry = await lcDb.languageEntry.findUnique({ where: { id: input.entryId } });
  if (!entry) throw NotFound("Entrée introuvable.");
  assertScopeAccess(entry, actor);
  const updated = await lcDb.languageEntry.update({
    where: { id: entry.id },
    data: { status: "ARCHIVED", archivedAt: new Date(), version: { increment: 1 } },
  });
  await snapshot(entry.id, "archivage", input.actorRef);
  await lcAudit({
    action: "LANGUAGE_ENTRY_ARCHIVED",
    entityType: "language_entry",
    entityId: entry.id,
    actorRef: input.actorRef,
  });
  return updated;
}

// ── Variantes / traductions / intents / exemples ──

export async function addVariant(
  input: {
    entryId: string;
    text: string;
    variantType?: LanguageVariantType;
    region?: string | null;
    notes?: string | null;
    actorRef?: string | null;
  },
  actor: ActorScope,
) {
  await ensureEntry(input.entryId, actor);
  const v = await lcDb.languageVariant.create({
    data: {
      languageEntryId: input.entryId,
      text: input.text.trim(),
      normalizedText: normalizeText(input.text),
      variantType: input.variantType ?? "SPELLING",
      region: input.region ?? null,
      notes: input.notes ?? null,
      status: "SUGGESTED",
    },
  });
  await lcAudit({
    action: "VARIANT_ADDED",
    entityType: "language_variant",
    entityId: v.id,
    actorRef: input.actorRef ?? null,
    metadata: { entryId: input.entryId, variantType: v.variantType },
  });
  return v;
}

export async function addTranslation(
  input: {
    entryId: string;
    language: LanguageCode;
    text: string;
    source?: LanguageSource;
    actorRef?: string | null;
  },
  actor: ActorScope,
) {
  await ensureEntry(input.entryId, actor);
  const t = await lcDb.languageTranslation.create({
    data: {
      languageEntryId: input.entryId,
      language: input.language,
      text: input.text.trim(),
      source: input.source ?? "HUMAN",
      status: "SUGGESTED",
    },
  });
  await lcAudit({
    action: "TRANSLATION_ADDED",
    entityType: "language_translation",
    entityId: t.id,
    actorRef: input.actorRef ?? null,
    metadata: { entryId: input.entryId, language: input.language },
  });
  return t;
}

export async function addIntentMapping(
  input: {
    entryId: string;
    intentCode: string;
    domainCode?: string | null;
    confidence?: number | null;
    actorRef?: string | null;
  },
  actor: ActorScope,
) {
  await ensureEntry(input.entryId, actor);
  const m = await lcDb.languageIntentMapping.create({
    data: {
      languageEntryId: input.entryId,
      intentCode: input.intentCode.trim().toUpperCase(),
      domainCode: input.domainCode ?? null,
      confidence: input.confidence ?? null,
      status: "SUGGESTED",
    },
  });
  await lcAudit({
    action: "INTENT_MAPPING_ADDED",
    entityType: "language_intent_mapping",
    entityId: m.id,
    actorRef: input.actorRef ?? null,
    metadata: { entryId: input.entryId, intentCode: m.intentCode },
  });
  return m;
}

// ── helpers ──

async function ensureEntry(id: string, actor: ActorScope) {
  const e = await lcDb.languageEntry.findUnique({
    where: { id },
    select: { id: true, scope: true, organizationId: true },
  });
  if (!e) throw NotFound("Entrée introuvable.");
  assertScopeAccess(e, actor);
}

async function snapshot(entryId: string, reason: string, changedByRef: string | null) {
  const fresh = await lcDb.languageEntry.findUnique({
    where: { id: entryId },
    include: { variants: true, translations: true, intentMappings: true, examples: true },
  });
  if (!fresh) return;
  try {
    await lcDb.languageEntryRevision.create({
      data: {
        languageEntryId: entryId,
        version: fresh.version,
        snapshot: JSON.parse(JSON.stringify(fresh)) as Prisma.InputJsonValue,
        changedByRef,
        changeReason: reason.slice(0, 300),
      },
    });
  } catch {
    // Unicité (entryId, version) — snapshot déjà pris pour cette version.
  }
}
