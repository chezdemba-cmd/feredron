import "server-only";
import { randomUUID } from "node:crypto";
import { MetaWhatsAppProvider } from "./client";
import type {
  WhatsAppProvider,
  WhatsAppSendContext,
  WhatsAppSendResult,
} from "./types";

/**
 * Provider de développement / test : ne contacte JAMAIS Meta. Retourne un
 * identifiant de message factice. Sélectionné explicitement par configuration
 * (`WHATSAPP_PROVIDER=mock`) — jamais actif en production par accident.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock" as const;

  async sendText(
    _ctx: WhatsAppSendContext,
    _body: string,
  ): Promise<WhatsAppSendResult> {
    return { ok: true, externalMessageId: `mock-${randomUUID()}` };
  }

  async sendTemplate(
    _ctx: WhatsAppSendContext,
    _template: { name: string; languageCode: string },
  ): Promise<WhatsAppSendResult> {
    return { ok: true, externalMessageId: `mock-tpl-${randomUUID()}` };
  }

  async sendAudio(
    _ctx: WhatsAppSendContext,
    _audio: Buffer,
    _mimeType: string,
  ): Promise<WhatsAppSendResult> {
    return { ok: true, externalMessageId: `mock-audio-${randomUUID()}` };
  }
}

let cached: WhatsAppProvider | null = null;

/**
 * Fabrique le provider selon `WHATSAPP_PROVIDER` :
 *  - "meta" → API Cloud réelle (version `META_GRAPH_API_VERSION`)
 *  - "mock" → provider factice ; REFUSÉ en production sauf
 *    `WHATSAPP_ALLOW_MOCK_IN_PROD=1`.
 */
export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached;

  const kind = process.env.WHATSAPP_PROVIDER ?? "mock";
  if (kind === "meta") {
    cached = new MetaWhatsAppProvider(
      process.env.META_GRAPH_API_VERSION ?? "v23.0",
    );
    return cached;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.WHATSAPP_ALLOW_MOCK_IN_PROD !== "1"
  ) {
    throw new Error(
      "WHATSAPP_PROVIDER=mock interdit en production. Définir WHATSAPP_PROVIDER=meta " +
        "ou, en connaissance de cause, WHATSAPP_ALLOW_MOCK_IN_PROD=1.",
    );
  }

  cached = new MockWhatsAppProvider();
  return cached;
}

/** Pour les tests : force le provider utilisé. */
export function __setWhatsAppProviderForTests(p: WhatsAppProvider | null): void {
  cached = p;
}
