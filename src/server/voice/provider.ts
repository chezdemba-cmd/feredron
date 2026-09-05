import "server-only";
import { getEnv } from "@/lib/env";
import { AppError, logError } from "@/server/errors";
import type {
  VoiceProvider,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
} from "./provider-types";
import { MockVoiceProvider } from "./mock-provider";

/**
 * Échec de transcription remontable à l'utilisateur. Hérite d'`AppError` pour
 * que `runAction` expose `userMessage` tel quel dans l'UI (le bouton micro),
 * au lieu du message générique « erreur inattendue ». `reason` est un code
 * stable pour les logs et l'`errorCode` de `VoiceTranscription`.
 */
export class VoiceTranscribeError extends AppError {
  readonly reason: string;
  constructor(reason: string, userMessage: string, cause?: unknown) {
    super("CONFLICT", userMessage, cause ? { cause } : undefined);
    this.name = "VoiceTranscribeError";
    this.reason = reason;
  }
}

/** Code stable (logs + `errorCode`) selon le statut HTTP du moteur STT. */
function voiceErrorReason(status: number): string {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 413 || status === 415 || status === 422)
    return "BAD_AUDIO";
  if (status >= 500) return "UPSTREAM";
  return `HTTP_${status}`;
}

/** Extension de fichier attendue par l'API STT (détection du format par le nom). */
function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3") || m.includes("mpga")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "webm";
}

/** Message montrable à l'utilisateur selon le statut HTTP du moteur STT. */
function voiceErrorMessage(status: number): string {
  if (status === 401 || status === 403)
    return "La transcription vocale est mal configurée (clé refusée). Prévenez l’administrateur.";
  if (status === 429)
    return "Le service de transcription a atteint sa limite. Réessayez dans quelques minutes.";
  if (status === 400 || status === 413 || status === 415 || status === 422)
    return "Cet enregistrement n’a pas pu être transcrit (format ou durée). Réessayez.";
  if (status >= 500)
    return "Le service de transcription est indisponible pour le moment. Réessayez plus tard.";
  return "Échec de la transcription vocale. Réessayez dans un instant.";
}

export type {
  VoiceProvider,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
} from "./provider-types";
export { MockVoiceProvider } from "./mock-provider";

/**
 * Provider speech-to-text compatible OpenAI (`POST {base}/audio/transcriptions`,
 * multipart `file` + `model` + `language?`). Architecture remplaçable ; la clé
 * API n'est jamais exposée au frontend ni journalisée.
 */
class OpenAiCompatibleVoiceProvider implements VoiceProvider {
  readonly name = "openai-compatible";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(cfg: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
  }) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.model = cfg.model;
    this.timeoutMs = cfg.timeoutMs;
  }

  async transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const mimeType = input.mimeType || "audio/ogg";
      const form = new FormData();
      form.append(
        "file",
        new Blob([Buffer.from(input.audio)], { type: mimeType }),
        // L'API STT déduit le format de l'extension : un nom sans extension → HTTP 400.
        `audio.${extForMime(mimeType)}`,
      );
      form.append("model", this.model);
      // `verbose_json` (segments + durée pour la confiance) n'existe que sur whisper-1 ;
      // les modèles gpt-4o-*-transcribe rejettent ce format (HTTP 400).
      form.append(
        "response_format",
        /whisper/i.test(this.model) ? "verbose_json" : "json",
      );
      // `language` attend UN seul code ISO-639-1 ; un indice multi-langue ("fr,bm")
      // provoque un HTTP 400. Sinon on laisse le moteur auto-détecter (fr/bambara).
      const lang = input.languageHint?.trim().toLowerCase();
      if (lang && /^[a-z]{2}$/.test(lang)) form.append("language", lang);

      const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        logError("voice.provider.transcribe", new Error(`HTTP ${res.status}`), {
          status: res.status,
        });
        throw new VoiceTranscribeError(
          voiceErrorReason(res.status),
          voiceErrorMessage(res.status),
        );
      }

      const data = (await res.json()) as {
        text?: string;
        language?: string;
        duration?: number;
        segments?: Array<{ avg_logprob?: number; no_speech_prob?: number }>;
      };

      const avgLogprob =
        data.segments && data.segments.length > 0
          ? data.segments.reduce((s, x) => s + (x.avg_logprob ?? -1), 0) /
            data.segments.length
          : null;
      const confidence =
        avgLogprob == null
          ? null
          : Math.max(0, Math.min(1, Math.exp(avgLogprob)));

      return {
        text: (data.text ?? "").trim(),
        detectedLanguage: data.language ?? null,
        confidence,
        durationMs:
          typeof data.duration === "number"
            ? Math.round(data.duration * 1000)
            : null,
        provider: this.name,
        model: this.model,
      };
    } catch (error) {
      if (error instanceof VoiceTranscribeError) throw error; // déjà journalisé
      const aborted = error instanceof Error && error.name === "AbortError";
      logError("voice.provider.transcribe", error, { aborted });
      throw new VoiceTranscribeError(
        aborted ? "TIMEOUT" : "NETWORK",
        aborted
          ? "Le service de transcription a mis trop de temps à répondre. Réessayez."
          : "Le service de transcription est momentanément injoignable. Réessayez dans un instant.",
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

const DEFAULT_OPENAI_VOICE_BASE_URL = "https://api.openai.com/v1";

let cached: VoiceProvider | null = null;

export function getVoiceProvider(): VoiceProvider {
  if (cached) return cached;
  const env = getEnv();
  if (env.VOICE_PROVIDER === "openai-compatible" && env.VOICE_API_KEY) {
    const baseUrl = env.VOICE_BASE_URL || DEFAULT_OPENAI_VOICE_BASE_URL;
    cached = new OpenAiCompatibleVoiceProvider({
      apiKey: env.VOICE_API_KEY,
      baseUrl,
      model: env.VOICE_MODEL,
      timeoutMs: env.VOICE_TIMEOUT_MS,
    });
    return cached;
  }
  // Repli mock. `getEnv()` bloque déjà le démarrage en production si
  // VOICE_PROVIDER=mock sans VOICE_ALLOW_MOCK_IN_PROD=1 (§12).
  if (env.VOICE_PROVIDER === "openai-compatible") {
    logError("voice.provider.fallbackToMock", {
      reason: "VOICE_API_KEY manquant",
    });
  }
  cached = new MockVoiceProvider();
  return cached;
}

export function __setVoiceProviderForTests(p: VoiceProvider | null): void {
  cached = p;
}
