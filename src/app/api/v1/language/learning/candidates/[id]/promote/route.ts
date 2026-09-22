import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireClient, clientOrgActorScope } from "@/language-core/api-helpers";
import { promoteLearningCandidate } from "@/language-core/learning/promotion-service";
import { isAppError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/language/learning/candidates/:id/promote
 * → crée une LanguageEntry / Variant / ... en statut SUGGESTED (jamais VALIDATED,
 *   jamais GLOBAL automatiquement — §22, §63).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireClient(request, "language.review");
  if ("response" in gate) return gate.response;
  const { id } = await params;
  try {
    const res = await promoteLearningCandidate(
      {
        candidateId: id,
        actorRef: `app:${gate.client.applicationCode}`,
      },
      clientOrgActorScope(gate.client),
    );
    return NextResponse.json({ ...res, promotedStatus: "SUGGESTED" });
  } catch (e) {
    if (isAppError(e)) return apiError(e.status, "CONFLICT", e.userMessage);
    return apiError(500, "INTERNAL", "Promotion impossible.");
  }
}
