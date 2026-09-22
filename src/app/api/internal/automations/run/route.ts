import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { getAutomationScheduler } from "@/server/automations/scheduler";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { runPendingJobs } from "@/server/jobs/queue";
import { verifyInternalSecretHeader, verifyVercelCronRequest } from "@/server/security/internal-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle() {
  const scheduled = await getAutomationScheduler().runDue();

  // Si la file est utilisée, on traite aussi les jobs prêts dans la foulée.
  let jobs = { processed: 0, completed: 0, failed: 0 };
  if (getEnv().AUTOMATION_DISPATCH === "queue") {
    registerAllJobHandlers();
    jobs = await runPendingJobs(100);
  }

  return NextResponse.json({ ok: true, scheduled, jobs }, { status: 200 });
}

/**
 * Déclencheur interne des automatisations (§31). Protégé par un secret partagé
 * (`AUTOMATION_CRON_SECRET`) via l'en-tête `x-automation-secret`. À appeler par
 * un cron externe, un worker, ou manuellement. Aucune action externe n'en
 * découle : uniquement de la détection → recommandations.
 */
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
