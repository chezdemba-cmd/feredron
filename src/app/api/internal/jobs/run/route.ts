import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { runPendingJobs } from "@/server/jobs/queue";
import { verifyInternalSecretHeader, verifyVercelCronRequest } from "@/server/security/internal-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: NextRequest) {
  const limitRaw = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, limitRaw) : 50;
  registerAllJobHandlers();
  const result = await runPendingJobs(limit);
  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}

/** Traite un lot de jobs prêts (§32-35). Même secret que les automatisations.
 *  Déclenchement manuel / worker / cron externe. */
export async function POST(request: NextRequest) {
  const secret = getEnv().AUTOMATION_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "AUTOMATION_CRON_SECRET non configuré." },
      { status: 503 },
    );
  }
  if (!verifyInternalSecretHeader(request, secret)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  return handle(request);
}

/** Déclenchement par Vercel Cron (`vercel.json`) — GET, secret via `CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = getEnv().AUTOMATION_CRON_SECRET;
  if (!secret || !verifyVercelCronRequest(request, secret)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  return handle(request);
}
