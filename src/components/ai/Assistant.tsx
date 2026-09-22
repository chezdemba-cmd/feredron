"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  askAssistantAction,
  approveAiProposalAction,
  rejectAiProposalAction,
} from "@/server/actions/ai.actions";
import type { AssistantAnswer } from "@/server/ai/assistant-service";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { MicButton } from "@/components/voice/MicButton";

const SUGGESTIONS = [
  "Que dois-je surveiller aujourd'hui ?",
  "Qui dois-je relancer ?",
  "Quels stocks sont faibles ?",
  "Quels clients sont inactifs ?",
  "Quelles commandes traînent ?",
  "J'ai encore 20 ensembles Bazin. Je veux les vendre cette semaine.",
];

type Turn = { question: string; answer?: AssistantAnswer; error?: string };

export type ProactiveBanner = {
  headline: string;
  items: Array<{ label: string; href: string }>;
};

export function Assistant({
  organizationId,
  proactive,
}: {
  organizationId: string;
  proactive?: ProactiveBanner | null;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [voiceMeta, setVoiceMeta] = useState<{ original: string; language: string } | null>(null);
  const pendingQ = useRef<string | null>(null);
  const [state, formAction, isPending] = useActionState(askAssistantAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestTurnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    setTurns((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && !last.answer && !last.error) {
        if (state.ok) last.answer = state.data;
        else last.error = state.error;
      }
      return next;
    });
  }, [state]);

  useEffect(() => {
    if (turns.length > 0) {
      latestTurnRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [turns]);

  function submit(question: string, voice?: { original: string; language: string }) {
    pendingQ.current = question;
    setTurns((prev) => [...prev, { question }]);
    const fd = new FormData();
    fd.set("organizationId", organizationId);
    fd.set("question", question);
    if (voice && voice.original !== question) {
      fd.set("voiceOriginalText", voice.original);
      fd.set("voiceLanguage", voice.language);
    }
    formAction(fd);
    formRef.current?.reset();
    setVoiceMeta(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {proactive ? (
        <Card style={{ background: "var(--card-alt)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: proactive.items.length ? 8 : 0 }}>
            {proactive.headline}
          </div>
          {proactive.items.length ? (
            <div className="assistant-opportunities" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {proactive.items.map((it) => (
                <a key={it.label} href={it.href} className="dj-badge" style={{ fontWeight: 600, color: "var(--text-2)" }}>
                  {it.label}
                </a>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
      <Card>
        <div className="assistant-suggestions" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="dj-badge"
              style={{ fontWeight: 600, color: "var(--text-2)", cursor: "pointer", border: "none" }}
              onClick={() => submit(s)}
              disabled={isPending}
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="assistant-composer"
          ref={formRef}
          action={(fd) => {
            const q = String(fd.get("question") ?? "").trim();
            if (q) submit(q, voiceMeta ?? undefined);
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <input
            ref={inputRef}
            name="question"
            required
            maxLength={1000}
            placeholder="Posez une question sur vos données…"
            className="dj-input"
            style={{ flex: 1, minWidth: 180 }}
          />
          <MicButton
            organizationId={organizationId}
            onTranscribed={(text, language) => {
              if (inputRef.current) {
                inputRef.current.value = text;
                inputRef.current.focus();
              }
              setVoiceMeta({ original: text, language });
            }}
            disabled={isPending}
          />
          <SubmitButton>Demander</SubmitButton>
        </form>
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
          Parlez ou écrivez ; vérifiez le texte avant d&apos;envoyer. Les chiffres
          proviennent de la base, pas du modèle. Les actions
          (relance, commande) demandent votre confirmation.
        </p>
      </Card>

      {turns.length === 0 ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[...turns].reverse().map((t, idx) => (
            <div key={turns.length - 1 - idx} ref={idx === 0 ? latestTurnRef : undefined}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                {t.question}
              </div>
              {!t.answer && !t.error ? (
                <div style={{ fontSize: 13, color: "var(--text-3)" }}>
                  FEREDRON IA prépare une réponse…
                </div>
              ) : null}
              {t.error ? (
                <div className="dj-alert dj-alert--error" style={{ margin: 0 }}>
                  {t.error}
                </div>
              ) : null}
              {t.answer ? (
                <>
                  <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {t.answer.answer}
                  </p>
                  {t.answer.handoffReason ? (
                    <div
                      className="dj-alert dj-alert--info"
                      style={{ margin: "0 0 10px" }}
                    >
                      Intervention humaine suggérée — {t.answer.handoffReason}
                    </div>
                  ) : null}
                  {t.answer.cards.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 14,
                        padding: "12px 14px",
                        marginBottom: 8,
                        background: "var(--card-alt)",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6 }}>
                        {c.title}
                      </div>
                      {c.lines.map((l, j) => (
                        <div key={j} className="tnum" style={{ fontSize: 13 }}>
                          {l}
                        </div>
                      ))}
                    </div>
                  ))}
                  {t.answer.proposal ? (
                    <ProposalControls
                      organizationId={organizationId}
                      proposal={t.answer.proposal}
                      onDone={(redirectTo) => {
                        if (redirectTo) router.push(redirectTo);
                        else router.refresh();
                      }}
                    />
                  ) : null}
                </>
              ) : null}
            </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalControls({
  organizationId,
  proposal,
  onDone,
}: {
  organizationId: string;
  proposal: { id: string; type: string; summary: string };
  onDone: (redirectTo?: string) => void;
}) {
  const [approveState, approveAction] = useActionState(approveAiProposalAction, null);
  const [rejectState, rejectAction] = useActionState(rejectAiProposalAction, null);

  useEffect(() => {
    if (approveState?.ok) onDone(approveState.data.redirectTo);
  }, [approveState, onDone]);
  useEffect(() => {
    if (rejectState?.ok) onDone();
  }, [rejectState, onDone]);

  return (
    <div
      style={{
        border: "1px solid var(--accent)",
        borderRadius: 14,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>
        Action proposée : {proposal.summary}
      </div>
      <div className="assistant-proposal-actions" style={{ display: "flex", gap: 8 }}>
        <form action={approveAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <SubmitButton>Confirmer</SubmitButton>
        </form>
        <form action={rejectAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <button type="submit" className="dj-btn dj-btn--ghost">
            Refuser
          </button>
        </form>
      </div>
      {approveState && !approveState.ok ? (
        <span className="dj-error">{approveState.error}</span>
      ) : null}
    </div>
  );
}
