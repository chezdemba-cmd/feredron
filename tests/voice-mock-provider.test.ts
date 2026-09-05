import { test } from "node:test";
import assert from "node:assert/strict";
import { MockVoiceProvider } from "../src/server/voice/mock-provider.ts";

const p = new MockVoiceProvider();
const enc = (s: string) => new TextEncoder().encode(s);

test("real WebM bytes are rejected instead of displayed as a transcript", async () => {
  await assert.rejects(
    p.transcribe({ audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42]), mimeType: "audio/webm" }),
    /only accepts UTF-8 text fixtures/,
  );
});

test("binary audio with valid UTF-8 is also rejected", async () => {
  await assert.rejects(
    p.transcribe({ audio: enc("RIFF\u0000\u0000WAVE"), mimeType: "audio/wav" }),
    /not binary audio/,
  );
});

test("déterministe : mêmes octets → même transcription", async () => {
  const a = await p.transcribe({ audio: enc("bonjour"), mimeType: "audio/ogg" });
  const b = await p.transcribe({ audio: enc("bonjour"), mimeType: "audio/ogg" });
  assert.deepEqual(a, b);
  assert.equal(a.provider, "mock");
});

test("buffer JSON → texte + langue + confiance + durée", async () => {
  const r = await p.transcribe({
    audio: enc('{"text":"je veux six sacs","language":"fr","confidence":0.83,"durationMs":3100}'),
    mimeType: "audio/ogg",
  });
  assert.equal(r.text, "je veux six sacs");
  assert.equal(r.detectedLanguage, "fr");
  assert.equal(r.confidence, 0.83);
  assert.equal(r.durationMs, 3100);
});

test("buffer texte brut → texte tel quel, langueHint reprise", async () => {
  const r = await p.transcribe({
    audio: enc("aw ni sɔgɔma"),
    mimeType: "audio/ogg",
    languageHint: "bm",
  });
  assert.equal(r.text, "aw ni sɔgɔma");
  assert.equal(r.detectedLanguage, "bm");
});

test("aucun appel réseau : renvoie toujours un résultat", async () => {
  const r = await p.transcribe({ audio: new Uint8Array(0), mimeType: "audio/ogg" });
  assert.equal(typeof r.text, "string");
  assert.equal(r.model, "mock-stt-1");
});
