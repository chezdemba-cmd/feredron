"use client";

import { useCallback, useRef, useState } from "react";
import { transcribeAppAudioAction } from "@/server/actions/voice.actions";
import { voiceHint } from "@/lib/voice-states";

type State = "idle" | "recording" | "transcribing" | "error";

const HINT: Record<State, string> = {
  idle: voiceHint("IDLE"),
  recording: voiceHint("RECORDING"),
  transcribing: voiceHint("TRANSCRIBING"),
  error: voiceHint("FAILED"),
};

/**
 * Bouton micro pour `/ai` (et réutilisable ailleurs). Enregistre via
 * `MediaRecorder`, envoie l'audio au serveur pour transcription éphémère (aucun
 * stockage), puis remonte le texte au parent qui pré-remplit le champ.
 * Mobile-first : gros bouton, indicateur d'enregistrement, durée, annuler.
 */
export function MicButton({
  organizationId,
  onTranscribed,
  disabled,
}: {
  organizationId: string;
  onTranscribed: (text: string, language: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
  }, []);

  const start = useCallback(async () => {
    setMsg(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof MediaRecorder === "undefined"
    ) {
      setState("error");
      setMsg("Micro non disponible sur ce navigateur.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      cancelledRef.current = false;
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        cleanup();
        if (cancelledRef.current || blob.size === 0) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const fd = new FormData();
          fd.set("organizationId", organizationId);
          fd.set("audio", blob, "recording.webm");
          const res = await transcribeAppAudioAction(null, fd);
          if (res.ok && res.data.text) {
            onTranscribed(res.data.text, res.data.language);
            setState("idle");
          } else {
            setState("error");
            setMsg(res.ok ? "Aucun texte détecté." : res.error);
          }
        } catch {
          setState("error");
          setMsg("Échec de la transcription.");
        }
      };
      rec.start();
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      // eslint-disable-next-line no-console
      console.error("mic.getUserMedia.failed", err);
      setState("error");
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setMsg("Autorisation micro refusée.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setMsg("Aucun microphone détecté sur cet appareil.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setMsg("Micro déjà utilisé par une autre application.");
      } else if (name === "SecurityError") {
        setMsg("Accès micro bloqué (contexte non sécurisé).");
      } else {
        setMsg(`Erreur micro : ${name || (err instanceof Error ? err.message : String(err))}`);
      }
    }
  }, [organizationId, onTranscribed, cleanup]);

  const stop = useCallback((cancel: boolean) => {
    cancelledRef.current = cancel;
    recRef.current?.stop();
  }, []);

  if (state === "recording") {
    return (
      <div className="mic-button-wrap mic-button-wrap--recording" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: "var(--accent)",
              animation: "pulse 1s infinite",
              flex: "none",
            }}
          />
          <span className="tnum" style={{ fontSize: 14, minWidth: 40 }}>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
          <button
            type="button"
            className="dj-btn dj-btn--primary"
            style={{ minHeight: 44 }}
            onClick={() => stop(false)}
          >
            Terminer
          </button>
          <button
            type="button"
            className="dj-btn dj-btn--ghost"
            style={{ minHeight: 44 }}
            onClick={() => stop(true)}
          >
            Annuler
          </button>
        </div>
        <span className="mic-button-hint" style={{ fontSize: 11, color: "var(--text-muted)" }}>{HINT.recording}</span>
      </div>
    );
  }

  return (
    <div className="mic-button-wrap" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          className="dj-btn dj-btn--outline"
          style={{ minHeight: 48, minWidth: 48, fontSize: 20, padding: "0 16px" }}
          onClick={start}
          disabled={disabled || state === "transcribing"}
          aria-label="Parler à FEREDRON"
          title="Poser la question à la voix (langue détectée automatiquement)"
        >
          {state === "transcribing" ? "…" : "🎤"}
        </button>
        {msg ? <span className="dj-error">{msg}</span> : null}
      </div>
      <span className="mic-button-hint" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {state === "error" ? HINT.error : state === "transcribing" ? HINT.transcribing : `${HINT.idle} · langue AUTO`}
      </span>
    </div>
  );
}
