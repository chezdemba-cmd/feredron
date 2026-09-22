import { NextResponse, type NextRequest } from "next/server";
import type { LanguageCode, LanguageScope } from "@prisma/client";
import { apiError, readJson, requireClient, clientOrgActorScope } from "@/language-core/api-helpers";
import { lcDb } from "@/language-core/db";
import { createEntry } from "@/language-core/entry-service";
import { isAppError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/language/entries?language=&domain=&scope=&status=&limit= */
export async function GET(request: NextRequest) {
  const gate = await requireClient(request, "language.read");
  if ("response" in gate) return gate.response;
  const { client } = gate;
  const p = request.nextUrl.searchParams;

  const scopeParam = p.get("scope") as LanguageScope | null;
  const scopes = scopeParam
    ? [scopeParam].filter((s) => client.allowedScopes.includes(s))
    : client.allowedScopes;
  if (scopes.length === 0) return NextResponse.json({ count: 0, entries: [] });

  const status = p.get("status");
  const entries = await lcDb.languageEntry.findMany({
    where: {
      scope: { in: scopes },
      ...(p.get("language") ? { language: p.get("language") as LanguageCode } : {}),
      ...(p.get("domain") ? { domainCode: p.get("domain") } : {}),
      ...(status ? { status: status as never } : { status: "VALIDATED" }),
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(100, Number(p.get("limit") ?? "50") || 50),
    include: { variants: true, translations: true, intentMappings: true },
  });

  return NextResponse.json({
    count: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      canonicalText: e.canonicalText,
      language: e.language,
      scope: e.scope,
      domainCode: e.domainCode,
      meaning: e.meaning,
      status: e.status,
      version: e.version,
    })),
  });
}

type CreateBody = {
  canonicalText?: string;
  language?: string;
  scope?: string;
  domain?: string;
  organizationId?: string;
  meaning?: string;
  frenchTranslation?: string;
};

/** POST /api/v1/language/entries — crée une entrée SUGGESTED. */
export async function POST(request: NextRequest) {
  const gate = await requireClient(request, "language.write");
  if ("response" in gate) return gate.response;
  const { client } = gate;

  const body = await readJson<CreateBody>(request);
  if (!body?.canonicalText || !body.language || !body.scope) {
    return apiError(400, "BAD_REQUEST", "canonicalText, language et scope requis.");
  }
  const scope = body.scope as LanguageScope;
  if (!client.allowedScopes.includes(scope)) {
    return apiError(403, "FORBIDDEN", "Scope non autorisé pour cette application.");
  }
  if (scope === "ORGANIZATION" && !client.permissions.includes("language.organization.write")) {
    return apiError(403, "FORBIDDEN", "Permission language.organization.write requise.");
  }

  try {
    const entry = await createEntry(
      {
        canonicalText: body.canonicalText,
        language: body.language as LanguageCode,
        scope,
        domainCode: body.domain ?? null,
        organizationId: body.organizationId ?? null,
        meaning: body.meaning ?? null,
        frenchTranslation: body.frenchTranslation ?? null,
        source: "IMPORT",
        status: "SUGGESTED",
        createdByRef: `app:${client.applicationCode}`,
      },
      clientOrgActorScope(client),
    );
    return NextResponse.json({ id: entry.id, status: entry.status }, { status: 201 });
  } catch (e) {
    if (isAppError(e)) return apiError(409, "CONFLICT", e.userMessage);
    return apiError(500, "INTERNAL", "Création impossible.");
  }
}
