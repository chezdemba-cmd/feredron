import { test } from "node:test";
import assert from "node:assert/strict";
import { hashResetToken } from "../src/server/auth/password-reset.ts";
import { buildPasswordResetEmail } from "../src/server/email/templates.ts";
import { MockEmailProvider } from "../src/server/email/mock-provider.ts";

test("hashResetToken : SHA-256 hex déterministe, jamais le clair", () => {
  const h = hashResetToken("abc123");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashResetToken("abc123"));
  assert.notEqual(h, hashResetToken("abc124"));
  assert.notEqual(h, "abc123");
});

test("buildPasswordResetEmail : sujet + lien présents, HTML échappé", () => {
  const m = buildPasswordResetEmail({
    firstName: "A<b>",
    resetUrl: "https://app.example/reset-password/tok123",
    ttlMinutes: 60,
  });
  assert.match(m.subject, /FEREDRON/);
  assert.ok(m.text.includes("https://app.example/reset-password/tok123"));
  assert.ok(m.html.includes("https://app.example/reset-password/tok123"));
  assert.ok(m.html.includes("A&lt;b&gt;"), "le prénom est échappé dans le HTML");
  assert.ok(!m.html.includes("A<b>"));
  assert.match(m.text, /60 minutes/);
});

test("MockEmailProvider : n'envoie rien, renvoie un succès", async () => {
  const r = await new MockEmailProvider().send({
    to: "x@y.z",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
  });
  assert.equal(r.ok, true);
});

test("ResendEmailProvider : envoi réussi retourne id", async () => {
  const { ResendEmailProvider } = await import("../src/server/email/resend-provider.ts");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Authorization"], "Bearer re_test_key");
      return new Response(JSON.stringify({ id: "resend_msg_001" }), { status: 200 });
    }) as typeof fetch;

    const provider = new ResendEmailProvider({ apiKey: "re_test_key", from: "test@feredron.app" });
    const res = await provider.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
      text: "Hello",
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.id, "resend_msg_001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ResendEmailProvider : gère les erreurs de l'API Resend gracieusement", async () => {
  const { ResendEmailProvider } = await import("../src/server/email/resend-provider.ts");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ message: "Invalid API Key" }), { status: 401 });
    }) as typeof fetch;

    const provider = new ResendEmailProvider({ apiKey: "re_invalid", from: "test@feredron.app" });
    const res = await provider.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
      text: "Hello",
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error, "Invalid API Key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
