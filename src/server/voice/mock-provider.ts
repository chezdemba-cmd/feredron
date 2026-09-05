import type {
  VoiceProvider,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
} from "./provider-types.ts";

/**
 * Provider speech-to-text DÉTERMINISTE — AUCUN appel réseau, aucune clé.
 * Il ne « transcrit » rien : il lit le contenu du buffer audio.
 *
 * Convention de test / seed : le buffer contient soit
 *   - un JSON `{"text": "...", "language": "fr"|"bm"|"mixed", "confidence": 0.9,
 *     "durationMs": 3200}`
 *   - soit du texte brut UTF-8 (langue devinée par l'app).
 */
export class MockVoiceProvider implements VoiceProvider {
  readonly name = "mock";
  readonly model = "mock-stt-1";

  async transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult> {
    let raw: string;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(input.audio).trim();
    } catch {
      throw new Error("Mock voice provider only accepts UTF-8 text fixtures, not audio recordings.");
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
      throw new Error("Mock voice provider only accepts text fixtures, not binary audio.");
    }

    let text = raw;
    let language: string | null = null;
    let confidence: number | null = 0.9;
    let durationMs: number | null = null;

    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as {
          text?: string;
          language?: string;
          confidence?: number;
          durationMs?: number;
        };
        if (typeof parsed.text === "string") text = parsed.text;
        if (typeof parsed.language === "string") language = parsed.language;
        if (typeof parsed.confidence === "number") confidence = parsed.confidence;
        if (typeof parsed.durationMs === "number") durationMs = parsed.durationMs;
      } catch {
        /* garde le texte brut */
      }
    }

    if (input.languageHint && !language) language = input.languageHint;

    return {
      text,
      detectedLanguage: language,
      confidence,
      durationMs,
      provider: this.name,
      model: this.model,
      metadata: { bytes: input.audio.byteLength },
    };
  }
}
