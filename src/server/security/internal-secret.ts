import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Compare deux secrets en temps constant (les deux sont hachés d'abord, donc
 * la comparaison finale porte sur des buffers de longueur fixe — même une
 * différence de longueur entre les valeurs d'origine n'est pas observable).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Vérifie l'en-tête `x-automation-secret` des routes internes
 * (`/api/internal/*`) contre `AUTOMATION_CRON_SECRET`, en temps constant.
 * Utilisé pour un déclenchement manuel / worker / cron externe en POST.
 */
export function verifyInternalSecretHeader(
  request: NextRequest,
  expectedSecret: string,
): boolean {
  const provided = request.headers.get("x-automation-secret");
  if (!provided) return false;
  return timingSafeEqualString(provided, expectedSecret);
}

/**
 * Vérifie une invocation Vercel Cron (toujours en GET, en-tête
 * `Authorization: Bearer <CRON_SECRET>` injecté automatiquement par Vercel si
 * la variable de projet `CRON_SECRET` est définie — cf. docs/PRODUCTION.md).
 * On réutilise volontairement la valeur d'`AUTOMATION_CRON_SECRET` : poser
 * `CRON_SECRET` sur Vercel avec la MÊME valeur, pas un secret distinct de plus
 * à faire tourner.
 */
export function verifyVercelCronRequest(
  request: NextRequest,
  expectedSecret: string,
): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  return timingSafeEqualString(authHeader, `Bearer ${expectedSecret}`);
}
