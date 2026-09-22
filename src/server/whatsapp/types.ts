/** Types partagés de la couche WhatsApp (purs). */

export type WhatsAppSendContext = {
  phoneNumberId: string;
  accessToken: string;
  toWaId: string;
};

export type WhatsAppSendResult =
  | { ok: true; externalMessageId: string }
  | { ok: false; errorCode: string | null; errorMessage: string };

export type WhatsAppTemplateComponent = {
  type: "body" | "header" | "button";
  parameters: Array<{ type: "text"; text: string }>;
};

export interface WhatsAppProvider {
  readonly name: "mock" | "meta";
  sendText(ctx: WhatsAppSendContext, body: string): Promise<WhatsAppSendResult>;
  /**
   * Envoi d'un modèle approuvé (hors fenêtre 24 h). Préparé pour Phase 6/7 —
   * les ReminderCampaign de la Phase 4 l'appelleront plus tard.
   */
  sendTemplate(
    ctx: WhatsAppSendContext,
    template: {
      name: string;
      languageCode: string;
      components?: WhatsAppTemplateComponent[];
    },
  ): Promise<WhatsAppSendResult>;
  /**
   * Envoi d'une note vocale (réponse IA à un message vocal client, Djeli
   * Voice §Kooma TTS). `audio` = octets bruts, jamais persistés au repos.
   */
  sendAudio(
    ctx: WhatsAppSendContext,
    audio: Buffer,
    mimeType: string,
  ): Promise<WhatsAppSendResult>;
}
