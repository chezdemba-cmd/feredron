import "server-only";
import type { LanguageCode, LanguageScope } from "@prisma/client";
import { lcDb } from "./db";
import { createEntry } from "./entry-service";
import { lcAudit } from "./audit";

/**
 * Import de connaissances (CSV/JSON) — toujours en `SUGGESTED`, JAMAIS
 * `VALIDATED` directement (§42). Un dataset doit déclarer sa licence.
 */

export type ImportRow = {
  canonicalText: string;
  language: LanguageCode;
  meaning?: string | null;
  frenchTranslation?: string | null;
  domainCode?: string | null;
};

export async function registerDatasetSource(input: {
  name: string;
  license: string;
  url?: string | null;
  attribution?: string | null;
  usageRestrictions?: string | null;
}) {
  return lcDb.languageDatasetSource.create({ data: input });
}

export async function importEntries(input: {
  scope: Exclude<LanguageScope, "ORGANIZATION">;
  rows: ImportRow[];
  datasetName: string;
  license: string;
  actorRef?: string | null;
}): Promise<{ created: number; skipped: number; datasetSourceId: string }> {
  if (!input.license) throw new Error("Licence du dataset obligatoire.");
  const dataset = await registerDatasetSource({
    name: input.datasetName,
    license: input.license,
  });

  let created = 0;
  let skipped = 0;
  for (const row of input.rows.slice(0, 5000)) {
    if (!row.canonicalText?.trim()) {
      skipped += 1;
      continue;
    }
    try {
      // `input.scope` exclut ORGANIZATION par le type — un périmètre neutre suffit.
      await createEntry(
        {
          canonicalText: row.canonicalText,
          language: row.language,
          scope: input.scope,
          domainCode: input.scope === "DOMAIN" ? row.domainCode ?? null : null,
          meaning: row.meaning ?? null,
          frenchTranslation: row.frenchTranslation ?? null,
          source: "IMPORT",
          status: "SUGGESTED",
          createdByRef: input.actorRef ?? null,
          provenance: { datasetSourceId: dataset.id, dataset: input.datasetName, license: input.license },
        },
        { organizationId: "", isSuperAdmin: false },
      );
      created += 1;
    } catch {
      skipped += 1; // doublon ou ligne invalide
    }
  }

  await lcAudit({
    action: "IMPORT_CREATED",
    entityType: "language_dataset_source",
    entityId: dataset.id,
    actorRef: input.actorRef ?? null,
    metadata: { created, skipped, scope: input.scope, license: input.license },
  });
  return { created, skipped, datasetSourceId: dataset.id };
}
