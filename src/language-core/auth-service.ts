import "server-only";
import bcrypt from "bcryptjs";
import type { LanguageScope } from "@prisma/client";
import { lcDb } from "./db";
import { rateLimit } from "@/server/whatsapp/rate-limit";

/**
 * Authentification des applications consommant la Language API.
 * En-tête : `Authorization: Bearer <clientId>.<secret>`.
 * clientId/secret invalides → 401 ; permission absente → 403 (côté route).
 * Le secret n'est stocké que haché (bcrypt).
 */

export type AuthedClient = {
  applicationCode: string;
  applicationName: string;
  clientId: string;
  permissions: string[];
  allowedDomains: string[];
  allowedScopes: LanguageScope[];
};

export type AuthError = { status: 401 | 403 | 429; message: string };

const RATE_LIMIT_PER_MIN = 240;

export async function authenticateRequest(
  authorizationHeader: string | null,
): Promise<{ ok: true; client: AuthedClient } | { ok: false; error: AuthError }> {
  const raw = (authorizationHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  const dot = raw.indexOf(".");
  if (dot <= 0) {
    return { ok: false, error: { status: 401, message: "Identifiants manquants." } };
  }
  const clientId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);

  const client = await lcDb.languageApplicationClient.findUnique({
    where: { clientId },
    include: { application: true },
  });
  if (
    !client ||
    client.status !== "ACTIVE" ||
    client.application.status !== "ACTIVE"
  ) {
    return { ok: false, error: { status: 401, message: "Client invalide." } };
  }

  const match = await bcrypt.compare(secret, client.secretHash);
  if (!match) {
    return { ok: false, error: { status: 401, message: "Secret invalide." } };
  }

  const rl = rateLimit(`lang-api:${clientId}`, RATE_LIMIT_PER_MIN, 60_000);
  if (!rl.allowed) {
    return { ok: false, error: { status: 429, message: "Trop de requêtes." } };
  }

  void lcDb.languageApplicationClient
    .update({ where: { id: client.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    client: {
      applicationCode: client.application.code,
      applicationName: client.application.name,
      clientId,
      permissions: client.permissions,
      allowedDomains: client.application.allowedDomains,
      allowedScopes: client.application.allowedScopes as LanguageScope[],
    },
  };
}

/** Provisionne (ou renvoie) un client — usage seed / admin. */
export async function provisionClient(input: {
  applicationCode: string;
  applicationName: string;
  clientName: string;
  clientId: string;
  secret: string;
  permissions: string[];
  allowedDomains: string[];
  allowedScopes: LanguageScope[];
}): Promise<{ clientId: string }> {
  const app = await lcDb.languageApplication.upsert({
    where: { code: input.applicationCode },
    create: {
      code: input.applicationCode,
      name: input.applicationName,
      allowedDomains: input.allowedDomains,
      allowedScopes: input.allowedScopes,
    },
    update: {
      name: input.applicationName,
      allowedDomains: input.allowedDomains,
      allowedScopes: input.allowedScopes,
    },
  });
  const secretHash = await bcrypt.hash(input.secret, 12);
  await lcDb.languageApplicationClient.upsert({
    where: { clientId: input.clientId },
    create: {
      applicationId: app.id,
      name: input.clientName,
      clientId: input.clientId,
      secretHash,
      permissions: input.permissions,
    },
    update: { secretHash, permissions: input.permissions, status: "ACTIVE" },
  });
  return { clientId: input.clientId };
}
