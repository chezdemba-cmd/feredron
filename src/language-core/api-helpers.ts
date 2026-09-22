import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest, type AuthedClient } from "./auth-service";
import { clientCan, type LanguagePermission } from "./permissions";
import type { ActorScope } from "./access";

/** Enveloppe JSON d'erreur homogène pour la Language API v1. */
export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Authentifie la requête et vérifie une permission. Retourne le client ou une
 * réponse d'erreur prête (401 / 403 / 429).
 */
export async function requireClient(
  request: NextRequest,
  permission: LanguagePermission,
): Promise<{ client: AuthedClient } | { response: NextResponse }> {
  const auth = await authenticateRequest(request.headers.get("authorization"));
  if (!auth.ok) {
    return {
      response: apiError(
        auth.error.status,
        auth.error.status === 429 ? "RATE_LIMITED" : "UNAUTHORIZED",
        auth.error.message,
      ),
    };
  }
  if (!clientCan(auth.client.permissions, permission)) {
    return {
      response: apiError(403, "FORBIDDEN", `Permission « ${permission} » requise.`),
    };
  }
  return { client: auth.client };
}

/**
 * Périmètre d'un client API pour les mutations du Language Core (§ ci-dessus
 * `ActorScope`). Un client applicatif n'a pas d'organisation « propre » — il
 * n'est autorisé à toucher une entrée/candidat ORGANIZATION que s'il porte
 * explicitement `language.organization.write` (permission dédiée, distincte
 * de `language.write`/`language.review` génériques).
 */
export function clientOrgActorScope(client: AuthedClient): ActorScope {
  return {
    organizationId: "",
    isSuperAdmin: client.permissions.includes("language.organization.write"),
  };
}

export async function readJson<T>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
