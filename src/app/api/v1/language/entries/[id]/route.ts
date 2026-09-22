import { NextResponse, type NextRequest } from "next/server";
import { apiError, readJson, requireClient, clientOrgActorScope } from "@/language-core/api-helpers";
import { lcDb } from "@/language-core/db";
import { updateEntry } from "@/language-core/entry-service";
import { isAppError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function visible(scope: string, allowed: string[]) {
  return allowed.includes(scope);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireClient(request, "language.read");
  if ("response" in gate) return gate.response;
  const { id } = await params;

  const entry = await lcDb.languageEntry.findUnique({
    where: { id },
    include: {
      variants: true,
      translations: true,
      intentMappings: true,
      examples: true,
      revisions: { orderBy: { version: "desc" }, take: 20 },
    },
  });
  if (!entry || !visible(entry.scope, gate.client.allowedScopes)) {
    return apiError(404, "NOT_FOUND", "Entrée introuvable.");
  }
  if (
    entry.scope === "ORGANIZATION" &&
    !gate.client.permissions.includes("language.organization.read")
  ) {
    return apiError(403, "FORBIDDEN", "Permission organization.read requise.");
  }
  return NextResponse.json(entry);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireClient(request, "language.write");
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return apiError(400, "BAD_REQUEST", "Corps JSON invalide.");

  try {
    const updated = await updateEntry(
      {
        entryId: id,
        actorRef: `app:${gate.client.applicationCode}`,
        changeReason: typeof body.changeReason === "string" ? body.changeReason : null,
        patch: {
          ...(typeof body.canonicalText === "string" ? { canonicalText: body.canonicalText } : {}),
          ...("meaning" in body ? { meaning: (body.meaning as string) ?? null } : {}),
          ...("frenchTranslation" in body
            ? { frenchTranslation: (body.frenchTranslation as string) ?? null }
            : {}),
        },
      },
      clientOrgActorScope(gate.client),
    );
    return NextResponse.json({ id: updated.id, version: updated.version, status: updated.status });
  } catch (e) {
    if (isAppError(e)) return apiError(e.status, "CONFLICT", e.userMessage);
    return apiError(500, "INTERNAL", "Mise à jour impossible.");
  }
}
