import { test } from "node:test";
import assert from "node:assert/strict";
import { BambaraHfVoiceProvider } from "../src/server/voice/provider.ts";

const enc = (s: string) => new TextEncoder().encode(s);

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("réponse {text} → VoiceTranscribeResult, autres champs à null", async () => {
  const p = new BambaraHfVoiceProvider({
    baseUrl: "https://example-tunnel.test",
    model: "sudoping01/bambara-asr-v2",
    timeoutMs: 5000,
  });

  await withFetch(
    async (url, init) => {
      assert.equal(url, "https://example-tunnel.test/transcribe");
      assert.equal((init as RequestInit).method, "POST");
      return new Response(JSON.stringify({ text: "aw ni sɔgɔma" }), { status: 200 });
    },
    async () => {
      const r = await p.transcribe({ audio: enc("fake-audio"), mimeType: "audio/webm" });
      assert.equal(r.text, "aw ni sɔgɔma");
      assert.equal(r.detectedLanguage, null);
      assert.equal(r.confidence, null);
      assert.equal(r.durationMs, null);
      assert.equal(r.provider, "bambara-hf");
    },
  );
});

test("URL de base sans slash final tolérée", async () => {
  const p = new BambaraHfVoiceProvider({
    baseUrl: "https://example-tunnel.test/",
    model: "m",
    timeoutMs: 5000,
  });
  await withFetch(
    async (url) => {
      assert.equal(url, "https://example-tunnel.test/transcribe");
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    },
    () => p.transcribe({ audio: enc("x"), mimeType: "audio/webm" }),
  );
});

test("HTTP 500 → VoiceTranscribeError, message générique utilisateur", async () => {
  const p = new BambaraHfVoiceProvider({ baseUrl: "https://example-tunnel.test", model: "m", timeoutMs: 5000 });
  await withFetch(
    async () => new Response("boom", { status: 500 }),
    async () => {
      await assert.rejects(
        p.transcribe({ audio: enc("x"), mimeType: "audio/webm" }),
        /indisponible/i,
      );
    },
  );
});

test("réseau indisponible → VoiceTranscribeError réseau", async () => {
  const p = new BambaraHfVoiceProvider({ baseUrl: "https://example-tunnel.test", model: "m", timeoutMs: 5000 });
  await withFetch(
    async () => {
      throw new Error("fetch failed");
    },
    async () => {
      await assert.rejects(
        p.transcribe({ audio: enc("x"), mimeType: "audio/webm" }),
        /injoignable/i,
      );
    },
  );
});
