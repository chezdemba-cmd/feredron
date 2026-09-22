import { test } from "node:test";
import assert from "node:assert/strict";
import { MetaWhatsAppProvider } from "../src/server/whatsapp/client.ts";

/**
 * Verrouille le contrat d'envoi d'une note vocale IA via l'API Graph
 * (documentation officielle Meta vérifiée le 2026-09-22 : audio/mpeg accepté,
 * 16 Mo max) : upload média (POST .../media, multipart) PUIS envoi du message
 * référençant l'id média (POST .../messages, {type:"audio", audio:{id}}).
 * Non testé contre les vrais serveurs Meta (nécessiterait une connexion
 * WhatsApp active) — verrouille uniquement la forme de la requête émise.
 */

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("sendAudio : upload multipart puis envoi référençant l'id média", async () => {
  const provider = new MetaWhatsAppProvider("v21.0");
  const calls: string[] = [];

  await withFetch(
    async (url, init) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/media")) {
        const form = (init as RequestInit).body as FormData;
        assert.equal(form.get("messaging_product"), "whatsapp");
        assert.equal(form.get("type"), "audio/mpeg");
        assert.ok(form.get("file") instanceof Blob);
        return new Response(JSON.stringify({ id: "MEDIA_123" }), { status: 200 });
      }
      if (u.endsWith("/messages")) {
        const body = JSON.parse((init as RequestInit).body as string);
        assert.equal(body.type, "audio");
        assert.deepEqual(body.audio, { id: "MEDIA_123" });
        assert.equal(body.to, "22399999999");
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid.XYZ" }] }),
          { status: 200 },
        );
      }
      throw new Error(`URL inattendue : ${u}`);
    },
    async () => {
      const result = await provider.sendAudio(
        { phoneNumberId: "PNID_1", accessToken: "tok", toWaId: "22399999999" },
        Buffer.from("fake-mp3-bytes"),
        "audio/mpeg",
      );
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.externalMessageId, "wamid.XYZ");
    },
  );

  assert.equal(calls.length, 2, "upload puis envoi — exactement 2 appels");
});

test("sendAudio : échec de l'upload → pas de tentative d'envoi de message", async () => {
  const provider = new MetaWhatsAppProvider("v21.0");
  let messagesCalled = false;

  await withFetch(
    async (url) => {
      const u = String(url);
      if (u.endsWith("/media")) {
        return new Response(JSON.stringify({ error: { code: 400, message: "bad file" } }), {
          status: 400,
        });
      }
      messagesCalled = true;
      return new Response("{}", { status: 200 });
    },
    async () => {
      const result = await provider.sendAudio(
        { phoneNumberId: "PNID_1", accessToken: "tok", toWaId: "22399999999" },
        Buffer.from("x"),
        "audio/mpeg",
      );
      assert.equal(result.ok, false);
    },
  );

  assert.equal(messagesCalled, false);
});
