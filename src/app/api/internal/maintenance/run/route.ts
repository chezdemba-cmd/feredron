import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { runMaintenance } from "@/server/maintenance/cleanup";
import { verifyInternalSecretHeader, verifyVercelCronRequest } from "@/server/security/internal-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle() {
  const result = await runMaintenance();
  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}

/** Tâches d'entretien (§10). Même secret que les autres routes internes. */
export async function POST(request: NextRequest) {
  const secret = getEnv().AUTOMATION_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "AUTOMATION_CRON_SECRET non configuré." }, { status: 503 });
  }
  if (!verifyInternalSecretHeader(request, secret)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  return handle();
}

/** Déclenchement par Vercel Cron (`vercel.json`) — GET, secret via `CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = getEnv().AUTOMATION_CRON_SECRET;
  if (!secret || !verifyVercelCronRequest(request, secret)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  return handle();
}
