import "server-only";
import { logError } from "@/server/errors";

/**
 * WhatsApp Embedded Signup — échange serveur du "code" renvoyé par le SDK
 * Facebook Login for Business (jamais exploitable côté client) contre un
 * token d'accès utilisable pour l'API Graph. Flux standard OAuth de Meta,
 * réutilisé tel quel par Embedded Signup (doc Meta, 2026-09-23).
 */
export type ExchangeCodeResult =
  | { ok: true; accessToken: string }
  | { ok: false; errorMessage: string };

export async function exchangeSignupCode(input: {
  code: string;
  appId: string;
  appSecret: string;
  graphVersion: string;
}): Promise<ExchangeCodeResult> {
  const url = new URL(
    `https://graph.facebook.com/${input.graphVersion}/oauth/access_token`,
  );
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("code", input.code);

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: { message?: string };
    };
    if (!res.ok || !data.access_token) {
      return {
        ok: false,
        errorMessage: data.error?.message ?? `Échange du code échoué (HTTP ${res.status}).`,
      };
    }
    return { ok: true, accessToken: data.access_token };
  } catch (error) {
    logError("whatsapp.embeddedSignup.exchangeCode", error);
    return { ok: false, errorMessage: "Impossible de joindre l'API Meta pour l'échange du code." };
  }
}
