import { NextResponse, type NextRequest } from "next/server";
import { apiError, readJson, requireClient, clientOrgActorScope } from "@/language-core/api-helpers";
import { rejectEntry } from "@/language-core/entry-service";
import { isAppError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireClient(request, "language.validate");
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const body = await readJson<{ reason?: string }>(request);
  try {
    const e = await rejectEntry(
      {
        entryId: id,
        actorRef: `app:${gate.client.applicationCode}`,
        reason: body?.reason ?? null,
      },
      clientOrgActorScope(gate.client),
    );
    return NextResponse.json({ id: e.id, status: e.status });
  } catch (err) {
    if (isAppError(err)) return apiError(err.status, "CONFLICT", err.userMessage);
    return apiError(500, "INTERNAL", "Rejet impossible.");
  }
}
