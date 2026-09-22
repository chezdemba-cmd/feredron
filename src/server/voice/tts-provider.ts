import "server-only";
import { getEnv } from "@/lib/env";
import { logError } from "@/server/errors";

/**
 * Synthèse vocale (texte → audio) — réponse de Djeli IA à un message vocal
 * client. Contrat confirmé via https://api.kooma.ai/openapi.json (2026-09-22) :
 * POST {base}/audio/speech, JSON {voice, input, response_format}, réponse =
 * octets audio bruts (jamais persistés au repos — générés à la volée, envoyés,
 * jetés). `response_format=mp3` : seul format Kooma accepté par WhatsApp
 * (audio/mpeg) parmi les deux qu'ils proposent (wav | mp3).
 */
export interface TtsProvider {
  readonly name: string;
  synthesize(text: string): Promise<{ audio: Buffer; mimeType: string }>;
}

export class TtsError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = "TtsError";
    this.reason = reason;
  }
}

const DEFAULT_KOOMA_TTS_BASE_URL = "https://api.kooma.ai/v1";
const DEFAULT_KOOMA_VOICE = "modibo";

class KoomaTtsProvider implements TtsProvider {
  readonly name = "kooma";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly voice: string;
  private readonly timeoutMs: number;

  constructor(cfg: { apiKey: string; baseUrl: string; voice: string; timeoutMs: number }) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.voice = cfg.voice;
    this.timeoutMs = cfg.timeoutMs;
  }

  async synthesize(text: string): Promise<{ audio: Buffer; mimeType: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voice: this.voice,
          input: text.slice(0, 5000),
          response_format: "mp3",
        }),
      });
      if (!res.ok) {
        logError("tts.provider.synthesize", new Error(`HTTP ${res.status}`), {
          status: res.status,
        });
        throw new TtsError(
          res.status >= 500 ? "UPSTREAM" : `HTTP_${res.status}`,
          "Échec de la synthèse vocale.",
        );
      }
      const audio = Buffer.from(await res.arrayBuffer());
      return { audio, mimeType: "audio/mpeg" };
    } catch (error) {
      if (error instanceof TtsError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      logError("tts.provider.synthesize", error, { aborted });
      throw new TtsError(
        aborted ? "TIMEOUT" : "NETWORK",
        "Service de synthèse vocale injoignable.",
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

let cached: TtsProvider | null = null;

/**
 * `null` si aucun provider TTS n'est configuré (seul Kooma le propose
 * aujourd'hui) — l'appelant doit alors se rabattre sur du texte seul.
 */
export function getTtsProvider(): TtsProvider | null {
  if (cached) return cached;
  const env = getEnv();
  if (env.VOICE_PROVIDER === "kooma" && env.VOICE_API_KEY) {
    cached = new KoomaTtsProvider({
      apiKey: env.VOICE_API_KEY,
      baseUrl: env.VOICE_BASE_URL || DEFAULT_KOOMA_TTS_BASE_URL,
      voice: process.env.KOOMA_TTS_VOICE || DEFAULT_KOOMA_VOICE,
      timeoutMs: env.VOICE_TIMEOUT_MS,
    });
    return cached;
  }
  return null;
}

export function __setTtsProviderForTests(p: TtsProvider | null): void {
  cached = p;
}
