/**
 * Worker de fond Djeli (§7, §8, §10).
 *
 * Process SÉPARÉ de l'application web. Il ne dépend d'aucun `setImmediate`
 * serverless : il appelle périodiquement les routes internes protégées par
 * `AUTOMATION_CRON_SECRET`.
 *
 *   node --env-file-if-exists=.env scripts/worker.ts
 *
 * Boucles :
 *   - jobs        : POST /api/internal/jobs/run           (toutes WORKER_JOB_INTERVAL_MS)
 *   - scheduler   : POST /api/internal/automations/run    (toutes WORKER_SCHEDULER_INTERVAL_MS)
 *   - maintenance : POST /api/internal/maintenance/run    (idem scheduler)
 *
 * Sur une plateforme sans process long (serverless pur), remplacer par un cron
 * qui frappe ces trois routes.
 */
import { setTimeout as sleep } from "node:timers/promises";

const BASE = (
  process.env.INTERNAL_APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");
const SECRET = process.env.AUTOMATION_CRON_SECRET ?? "";
const JOB_INTERVAL = Number(process.env.WORKER_JOB_INTERVAL_MS ?? 5_000);
const SCHED_INTERVAL = Number(process.env.WORKER_SCHEDULER_INTERVAL_MS ?? 300_000);

if (!SECRET) {
  console.error("[worker] AUTOMATION_CRON_SECRET manquant — arrêt.");
  process.exit(1);
}

let running = true;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} reçu — arrêt propre.`);
    running = false;
  });
}

async function hit(path: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "x-automation-secret": SECRET },
    });
    const body = await res.json().catch(() => ({}));
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), worker: path, status: res.status, body }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        worker: path,
        error: err instanceof Error ? err.message : "unknown",
      }),
    );
  }
}

async function main(): Promise<void> {
  console.log(`[worker] démarré → ${BASE} (jobs ${JOB_INTERVAL}ms, scheduler ${SCHED_INTERVAL}ms)`);
  let lastScheduler = 0;
  while (running) {
    await hit("/api/internal/jobs/run?limit=50");
    const now = Date.now();
    if (now - lastScheduler >= SCHED_INTERVAL) {
      lastScheduler = now;
      await hit("/api/internal/automations/run");
      await hit("/api/internal/maintenance/run");
    }
    await sleep(JOB_INTERVAL);
  }
  console.log("[worker] arrêté.");
}

void main();
