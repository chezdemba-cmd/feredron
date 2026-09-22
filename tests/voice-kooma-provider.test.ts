import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiCompatibleVoiceProvider } from "../src/server/voice/provider.ts";

/**
 * Contrat Kooma confirmé via https://api.kooma.ai/openapi.json (2026-09-22) :
 * POST {base}/audio/transcriptions, multipart `file` (+ `model`,
 * `response_format`), réponse `{"text": ...}`, détection de langue
 * automatique (aucun paramètre `language` documenté). `OpenAiCompatibleVoiceProvider`
 * est réutilisé tel quel avec `name: "kooma"` — ces tests verrouillent que le
 * contrat réellement envoyé colle à ce que Kooma attend, notamment qu'aucun
 * `language` n'est envoyé (les appelants réels passent toujours "fr,bm",
 * rejeté par la regex 2-lettres — donc jamais transmis).
 */

const enc = (s: string) => new TextEncoder().encode(s);

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("kooma : POST {base}/audio/transcriptions, multipart file+model, sans language", async () => {
  const p = new OpenAiCompatibleVoiceProvider({
    apiKey: "kooma-test-key",
    baseUrl: "https://api.kooma.ai/v1",
    model: "kooma-stt-1",
    timeoutMs: 5000,
    name: "kooma",
  });

  await withFetch(
    async (url, init) => {
      assert.equal(url, "https://api.kooma.ai/v1/audio/transcriptions");
      assert.equal((init as RequestInit).method, "POST");
      const headers = (init as RequestInit).headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer kooma-test-key");
      const form = (init as RequestInit).body as FormData;
      assert.equal(form.get("model"), "kooma-stt-1");
      assert.equal(form.get("language"), null, "aucun paramètre language — Kooma ne le documente pas");
      assert.ok(form.get("file") instanceof Blob);
      return new Response(JSON.stringify({ text: "aw ni sɔgɔma" }), { status: 200 });
    },
    async () => {
      const r = await p.transcribe({
        audio: enc("fake-audio"),
        mimeType: "audio/ogg",
        languageHint: "fr,bm",
      });
      assert.equal(r.text, "aw ni sɔgɔma");
      assert.equal(r.provider, "kooma");
      assert.equal(r.model, "kooma-stt-1");
      // Champs non documentés par Kooma → dégradent proprement à null.
      assert.equal(r.detectedLanguage, null);
      assert.equal(r.confidence, null);
      assert.equal(r.durationMs, null);
    },
  );
});

test("kooma : HTTP 401 (clé refusée) → message générique utilisateur", async () => {
  const p = new OpenAiCompatibleVoiceProvider({
    apiKey: "bad-key",
    baseUrl: "https://api.kooma.ai/v1",
    model: "kooma-stt-1",
    timeoutMs: 5000,
    name: "kooma",
  });
  await withFetch(
    async () => new Response("unauthorized", { status: 401 }),
    async () => {
      await assert.rejects(
        p.transcribe({ audio: enc("x"), mimeType: "audio/ogg", languageHint: "fr,bm" }),
        /mal configurée/i,
      );
    },
  );
});
