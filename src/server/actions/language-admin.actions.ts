"use server";

import { revalidatePath } from "next/cache";
import type { LanguageCode, LanguageScope, LanguageVariantType } from "@prisma/client";
import { requireUserOrThrow } from "@/server/auth/current-user";
import { getOrgContext } from "@/server/tenant/context";
import { isSuperAdmin } from "@/server/admin/guard";
import { requirePermission } from "@/server/rbac/guard";
import { runAction, formToObject } from "./runner";
import { Forbidden } from "@/server/errors";
import { lcDb } from "@/language-core/db";
import type { ActorScope } from "@/language-core/access";
import {
  createEntry,
  updateEntry,
  validateEntry,
  rejectEntry,
  archiveEntry,
  addVariant,
  addTranslation,
  addIntentMapping,
} from "@/language-core/entry-service";
import { buildExport, type ExportFormat } from "@/language-core/export-service";
import { importEntries } from "@/language-core/import-service";
import type { ActionResult } from "@/lib/result";

/** Toutes ces actions exigent `language.admin` (OWNER / ADMIN). */
async function adminActor(): Promise<{ actorRef: string; scope: ActorScope }> {
  const user = await requireUserOrThrow();
  const ctx = await getOrgContext(user);
  if (!ctx) throw Forbidden("Aucune organisation active.");
  requirePermission(ctx.role, "language.admin");
  return {
    actorRef: `user:${user.id}`,
    scope: { organizationId: ctx.organization.id, isSuperAdmin: isSuperAdmin(user) },
  };
}

function rv() {
  revalidatePath("/language");
  revalidatePath("/language/entries");
  revalidatePath("/language/suggestions");
}

export async function createLanguageEntryAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await adminActor();
    const raw = formToObject(formData);
    const entry = await createEntry(
      {
        canonicalText: raw.canonicalText ?? "",
        language: (raw.language as LanguageCode) || "FR",
        scope: (raw.scope as LanguageScope) || "GLOBAL",
        domainCode: raw.domainCode || null,
        organizationId: raw.organizationId || null,
        meaning: raw.meaning || null,
        frenchTranslation: raw.frenchTranslation || null,
        source: "HUMAN",
        status: "SUGGESTED",
        createdByRef: actorRef,
      },
      scope,
    );
    rv();
    return { id: entry.id };
  });
}

export async function updateLanguageEntryAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await adminActor();
    const raw = formToObject(formData);
    const updated = await updateEntry(
      {
        entryId: raw.entryId ?? "",
        actorRef,
        changeReason: raw.changeReason || null,
        patch: {
          ...(raw.canonicalText ? { canonicalText: raw.canonicalText } : {}),
          meaning: raw.meaning || null,
          frenchTranslation: raw.frenchTranslation || null,
          englishTranslation: raw.englishTranslation || null,
        },
      },
      scope,
    );
    revalidatePath(`/language/entries/${updated.id}`);
    rv();
    return { id: updated.id };
  });
}

export async function validateLanguageEntryAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await adminActor();
    const raw = formToObject(formData);
    const e = await validateEntry({ entryId: raw.entryId ?? "", actorRef }, scope);
    revalidatePath(`/language/entries/${e.id}`);
    rv();
    return { id: e.id };
  });
}

export async function rejectLanguageEntryAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await adminActor();
    const raw = formToObject(formData);
    const e = await rejectEntry({ entryId: raw.entryId ?? "", actorRef, reason: raw.reason || null }, scope);
    revalidatePath(`/language/entries/${e.id}`);
    rv();
    return { id: e.id };
  });
}

export async function archiveLanguageEntryAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await adminActor();
    const raw = formToObject(formData);
    const e = await archiveEntry({ entryId: raw.entryId ?? "", actorRef }, scope);
    revalidatePath(`/language/entries/${e.id}`);
    rv();
    return { id: e.id };
  });
}

export async function addVariantAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await adminActor();
    const raw = formToObject(formData);
    const v = await addVariant(
      {
        entryId: raw.entryId ?? "",
        text: raw.text ?? "",
        variantType: (raw.variantType as LanguageVariantType) || "SPELLING",
        region: raw.region || null,
        actorRef,
      },
      scope,
    );
    revalidatePath(`/language/entries/${raw.entryId}`);
    return { id: v.id };
  });
}

export async function addTranslationAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await adminActor();
    const raw = formToObject(formData);
    const t = await addTranslation(
      {
        entryId: raw.entryId ?? "",
        language: (raw.language as LanguageCode) || "FR",
        text: raw.text ?? "",
        actorRef,
      },
      scope,
    );
    revalidatePath(`/language/entries/${raw.entryId}`);
    return { id: t.id };
  });
}

export async function addIntentAction(
  _p: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { actorRef, scope } = await adminActor();
    const raw = formToObject(formData);
    const m = await addIntentMapping(
      {
        entryId: raw.entryId ?? "",
        intentCode: raw.intentCode ?? "",
        domainCode: raw.domainCode || null,
        actorRef,
      },
      scope,
    );
    revalidatePath(`/language/entries/${raw.entryId}`);
    return { id: m.id };
  });
}

export async function createDomainAction(
  _p: ActionResult<{ code: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ code: string }>> {
  return runAction(async () => {
    await adminActor();
    const raw = formToObject(formData);
    const code = (raw.code ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!code) throw new Error("Code de domaine invalide.");
    await lcDb.languageDomain.upsert({
      where: { code },
      create: { code, name: raw.name || code, description: raw.description || null },
      update: { name: raw.name || code, description: raw.description || null },
    });
    revalidatePath("/language/domains");
    return { code };
  });
}

export async function exportLanguageAction(
  _p: ActionResult<{ body: string; count: number; contentType: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ body: string; count: number; contentType: string }>> {
  return runAction(async () => {
    const { actorRef } = await adminActor();
    const raw = formToObject(formData);
    const out = await buildExport(
      {
        format: (raw.format as ExportFormat) || "json",
        language: (raw.language as LanguageCode) || null,
        domainCode: raw.domainCode || null,
        scopes: ["GLOBAL", "DOMAIN"],
      },
      actorRef,
    );
    return { body: out.body, count: out.count, contentType: out.contentType };
  });
}

export async function importLanguageAction(
  _p: ActionResult<{ created: number; skipped: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  return runAction(async () => {
    const { actorRef } = await adminActor();
    const raw = formToObject(formData);
    let rows: unknown;
    try {
      rows = JSON.parse(raw.rows ?? "[]");
    } catch {
      throw new Error("JSON invalide.");
    }
    if (!Array.isArray(rows)) throw new Error("Le JSON doit être un tableau.");
    const res = await importEntries({
      scope: (raw.scope as "GLOBAL" | "DOMAIN") || "DOMAIN",
      rows: rows as never[],
      datasetName: raw.datasetName || "import-admin",
      license: raw.license || "unspecified",
      actorRef,
    });
    revalidatePath("/language/suggestions");
    return { created: res.created, skipped: res.skipped };
  });
}
