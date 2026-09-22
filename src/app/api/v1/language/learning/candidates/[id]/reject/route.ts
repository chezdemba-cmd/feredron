import { NextResponse, type NextRequest } from "next/server";
import { apiError, readJson, requireClient, clientOrgActorScope } from "@/language-core/api-helpers";
import { rejectCandidate } from "@/language-core/learning/review-service";
import { isAppError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireClient(request, "language.review");
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const body = await readJson<{ reason?: string }>(request);
  try {
    const c = await rejectCandidate(
      {
        candidateId: id,
        actorRef: `app:${gate.client.applicationCode}`,
        reason: body?.reason ?? null,
      },
      clientOrgActorScope(gate.client),
    );
    return NextResponse.json({ id: c.id, status: c.status });
  } catch (e) {
    if (isAppError(e)) return apiError(e.status, "CONFLICT", e.userMessage);
    return apiError(500, "INTERNAL", "Échec.");
  }
}
