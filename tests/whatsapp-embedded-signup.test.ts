import { test } from "node:test";
import assert from "node:assert/strict";
import { exchangeSignupCode } from "../src/server/whatsapp/embedded-signup.ts";

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("exchangeSignupCode : requête OAuth correcte, renvoie le token", async () => {
  await withFetch(
    async (url) => {
      const u = new URL(String(url));
      assert.equal(u.pathname, "/v21.0/oauth/access_token");
      assert.equal(u.searchParams.get("client_id"), "APP_ID_1");
      assert.equal(u.searchParams.get("client_secret"), "APP_SECRET_1");
      assert.equal(u.searchParams.get("code"), "CODE_XYZ");
      return new Response(JSON.stringify({ access_token: "EAAB..." }), { status: 200 });
    },
    async () => {
      const res = await exchangeSignupCode({
        code: "CODE_XYZ",
        appId: "APP_ID_1",
        appSecret: "APP_SECRET_1",
        graphVersion: "v21.0",
      });
      assert.equal(res.ok, true);
      if (res.ok) assert.equal(res.accessToken, "EAAB...");
    },
  );
});

test("exchangeSignupCode : erreur Meta remontée proprement", async () => {
  await withFetch(
    async () =>
      new Response(JSON.stringify({ error: { message: "Invalid verification code." } }), {
        status: 400,
      }),
    async () => {
      const res = await exchangeSignupCode({
        code: "bad",
        appId: "a",
        appSecret: "b",
        graphVersion: "v21.0",
      });
      assert.equal(res.ok, false);
      if (!res.ok) assert.match(res.errorMessage, /Invalid verification code/);
    },
  );
});
