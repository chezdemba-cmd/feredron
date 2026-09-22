import "server-only";
import type { LanguageScope } from "@prisma/client";
import { Forbidden } from "@/server/errors";

/**
 * Périmètre de l'appelant pour les mutations du Language Core. Les entrées
 * GLOBAL/DOMAIN sont un corpus partagé, volontairement modifiable par
 * n'importe quel admin d'organisation (`language.admin`/`language.review`) —
 * c'est le modèle de curation communautaire du corpus. Les entrées
 * ORGANIZATION sont, elles, strictement privées à une organisation
 * (cf. commentaire du schema Prisma) : un admin d'une autre organisation ne
 * doit jamais pouvoir les lire ni les modifier, sauf un opérateur Djeli
 * (superadmin plateforme).
 */
export type ActorScope = {
  organizationId: string;
  isSuperAdmin: boolean;
};

/**
 * Bloque l'accès à une ressource ORGANIZATION appartenant à une autre
 * organisation que celle de l'appelant. Ne restreint jamais GLOBAL/DOMAIN.
 */
export function assertScopeAccess(
  target: { scope: LanguageScope; organizationId: string | null },
  actor: ActorScope,
): void {
  if (
    target.scope === "ORGANIZATION" &&
    !actor.isSuperAdmin &&
    target.organizationId !== actor.organizationId
  ) {
    throw Forbidden("Cette ressource appartient à une autre organisation.");
  }
}

/**
 * Résout l'organizationId à utiliser à la CRÉATION d'une entrée ORGANIZATION :
 * un appelant non-superadmin ne peut jamais créer une entrée pour une autre
 * organisation que la sienne, quelle que soit la valeur reçue du client.
 */
export function resolveOwnedOrganizationId(
  scope: LanguageScope,
  requestedOrganizationId: string | null,
  actor: ActorScope,
): string | null {
  if (scope !== "ORGANIZATION") return null;
  if (actor.isSuperAdmin && requestedOrganizationId) return requestedOrganizationId;
  return actor.organizationId;
}
