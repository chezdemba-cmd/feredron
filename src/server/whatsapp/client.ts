import "server-only";
import { logError } from "@/server/errors";
import type {
  WhatsAppProvider,
  WhatsAppSendContext,
  WhatsAppSendResult,
  WhatsAppTemplateComponent,
} from "./types";

/**
 * Provider réel — WhatsApp Business Cloud API (Graph). Version centralisée via
 * `META_GRAPH_API_VERSION`. Aucun secret n'est journalisé.
 */
/** Délai maximal d'un appel à l'API Graph. Inférieur au timeout de
 *  transaction / job pour libérer le worker avant qu'il ne soit lui-même tué. */
const REQUEST_TIMEOUT_MS = 15_000;

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta" as const;
  private readonly version: string;

  constructor(version: string) {
    this.version = version;
  }

  private endpoint(phoneNumberId: string): string {
    return `https://graph.facebook.com/${this.version}/${encodeURIComponent(
      phoneNumberId,
    )}/messages`;
  }

  private mediaEndpoint(phoneNumberId: string): string {
    return `https://graph.facebook.com/${this.version}/${encodeURIComponent(
      phoneNumberId,
    )}/media`;
  }

  /** Upload d'un média avant envoi (requis par l'API Graph pour l'audio dynamique). */
  private async uploadMedia(
    ctx: WhatsAppSendContext,
    file: Buffer,
    mimeType: string,
  ): Promise<{ ok: true; mediaId: string } | { ok: false; result: WhatsAppSendResult }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.set("messaging_product", "whatsapp");
      form.set("type", mimeType);
      form.set(
        "file",
        new Blob([new Uint8Array(file)], { type: mimeType }),
        `audio.${mimeType === "audio/mpeg" ? "mp3" : "bin"}`,
      );

      const res = await fetch(this.mediaEndpoint(ctx.phoneNumberId), {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: { code?: number | string; message?: string };
      };
      if (!res.ok || !data.id) {
        return {
          ok: false,
          result: {
            ok: false,
            errorCode: data.error?.code != null ? String(data.error.code) : String(res.status),
            errorMessage: data.error?.message ?? `Échec de l'upload média (HTTP ${res.status}).`,
          },
        };
      }
      return { ok: true, mediaId: data.id };
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      logError("MetaWhatsAppProvider.uploadMedia", error);
      return {
        ok: false,
        result: {
          ok: false,
          errorCode: timedOut ? "TIMEOUT" : "NETWORK",
          errorMessage: timedOut
            ? "Délai dépassé lors de l'upload média WhatsApp."
            : "Impossible de joindre l'API WhatsApp (upload média).",
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(
    ctx: WhatsAppSendContext,
    payload: Record<string, unknown>,
  ): Promise<WhatsAppSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(this.endpoint(ctx.phoneNumberId), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ctx.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: ctx.toWaId,
          ...payload,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { code?: number | string; message?: string; type?: string };
      };

      if (!res.ok || data.error) {
        return {
          ok: false,
          errorCode:
            data.error?.code != null ? String(data.error.code) : String(res.status),
          // Message technique sanitisé — jamais le token ni le payload complet.
          errorMessage:
            data.error?.message ?? `Échec de l'envoi WhatsApp (HTTP ${res.status}).`,
        };
      }

      const id = data.messages?.[0]?.id;
      if (!id) {
        return {
          ok: false,
          errorCode: "NO_MESSAGE_ID",
          errorMessage: "Réponse Meta sans identifiant de message.",
        };
      }
      return { ok: true, externalMessageId: id };
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      logError("MetaWhatsAppProvider.post", error);
      return {
        ok: false,
        errorCode: timedOut ? "TIMEOUT" : "NETWORK",
        errorMessage: timedOut
          ? "Délai dépassé en joignant l'API WhatsApp."
          : "Impossible de joindre l'API WhatsApp.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  sendText(ctx: WhatsAppSendContext, body: string): Promise<WhatsAppSendResult> {
    return this.post(ctx, { type: "text", text: { preview_url: false, body } });
  }

  sendTemplate(
    ctx: WhatsAppSendContext,
    template: {
      name: string;
      languageCode: string;
      components?: WhatsAppTemplateComponent[];
    },
  ): Promise<WhatsAppSendResult> {
    return this.post(ctx, {
      type: "template",
      template: {
        name: template.name,
        language: { code: template.languageCode },
        ...(template.components ? { components: template.components } : {}),
      },
    });
  }

  async sendAudio(
    ctx: WhatsAppSendContext,
    audio: Buffer,
    mimeType: string,
  ): Promise<WhatsAppSendResult> {
    const uploaded = await this.uploadMedia(ctx, audio, mimeType);
    if (!uploaded.ok) return uploaded.result;
    return this.post(ctx, { type: "audio", audio: { id: uploaded.mediaId } });
  }
}
