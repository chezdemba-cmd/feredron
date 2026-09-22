import "server-only";
import * as Sentry from "@sentry/node";
import { getEnv } from "@/lib/env";
import { setExceptionSink } from "@/server/errors";
import { logger, looksLikeSecret } from "@/lib/logger";

/**
 * Suivi d'erreurs (§25). Si `SENTRY_DSN` est défini, initialise Sentry et
 * branche `Sentry.captureException` sur le sink d'exceptions : tout `logError()`
 * du serveur remonte alors dans Sentry. Sans DSN : no-op (les logs structurés
 * `level:error` restent émis sur stdout).
 *
 * À appeler UNE fois au démarrage de chaque process serveur : layout racine
 * (web) et `scripts/worker.ts` (worker). Idempotent.
 *
 * Aucune PII ni secret n'est transmis : pas de tracing, `sendDefaultPii:false`,
 * et `beforeSend` purge cookies / en-têtes / corps de requête.
 */
let installed = false;

export function installErrorTracking(): void {
  if (installed) return;
  installed = true;

  const env = getEnv();
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    release: env.APP_VERSION,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
      }
      return event;
    },
  });

  setExceptionSink((context, error, fields) => {
    Sentry.captureException(error, { tags: { context }, extra: sanitizeExtra(fields) });
  });

  logger.info("error-tracking.sentry.installed", {
    service: "error-tracking",
    environment: env.APP_ENV,
  });
}

const REDACT = /(token|secret|password|authorization|apikey|api_key|cookie)/i;

/** Filet de sécurité : ne jamais faire remonter un champ sensible dans `extra`. */
function sanitizeExtra(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = REDACT.test(k) || (typeof v === "string" && looksLikeSecret(v)) ? "[redacted]" : v;
  }
  return out;
}
