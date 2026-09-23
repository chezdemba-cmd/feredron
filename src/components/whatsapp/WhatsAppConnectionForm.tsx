"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
} from "@/server/actions/whatsapp.actions";
import { Field, Input, Select, Badge } from "@/components/ui";
import { SubmitButton, Feedback, fieldError } from "@/components/form";
import { WhatsAppEmbeddedSignupButton } from "./WhatsAppEmbeddedSignupButton";

export type WhatsAppConnectionView = {
  status: string;
  provider: string;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  businessAccountId: string | null;
  connectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  hasToken: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  DISCONNECTED: "Non connecté",
  PENDING: "En attente",
  CONNECTED: "Connecté",
  ERROR: "Erreur",
  SUSPENDED: "Suspendu",
};

export function WhatsAppConnectionForm({
  organizationId,
  connection,
  canEdit,
  mockProvider,
  embeddedSignup,
}: {
  organizationId: string;
  connection: WhatsAppConnectionView | null;
  canEdit: boolean;
  /** true si WHATSAPP_PROVIDER=mock côté serveur (dev). */
  mockProvider: boolean;
  /** null si META_APP_ID/META_EMBEDDED_SIGNUP_CONFIG_ID non configurés. */
  embeddedSignup: { appId: string; configId: string; graphVersion: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(mockProvider ? "MOCK" : "META_CLOUD");
  const [connectState, connectAction] = useActionState(connectWhatsAppAction, null);
  const [disconnectState, disconnectAction] = useActionState(
    disconnectWhatsAppAction,
    null,
  );

  useEffect(() => {
    if (connectState?.ok || disconnectState?.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [connectState, disconnectState, router]);

  const connected = connection?.status === "CONNECTED";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Badge variant={connected ? "ok" : connection?.status === "ERROR" ? "accent" : "default"}>
          {STATUS_LABEL[connection?.status ?? "DISCONNECTED"] ?? connection?.status}
        </Badge>
        {connection?.displayPhoneNumber ? (
          <span className="tnum" style={{ fontSize: 13 }}>
            {connection.displayPhoneNumber}
          </span>
        ) : null}
        {connection?.verifiedName ? (
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>
            · {connection.verifiedName}
          </span>
        ) : null}
      </div>

      {connection ? (
        <dl style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, fontSize: 13 }}>
          <Row k="Phone Number ID" v={connection.phoneNumberId ?? "—"} mono />
          <Row k="WABA ID" v={connection.businessAccountId ?? "—"} mono />
          <Row
            k="Connecté le"
            v={connection.connectedAt ? new Date(connection.connectedAt).toLocaleString("fr-FR") : "—"}
          />
          <Row
            k="Dernier événement"
            v={connection.lastEventAt ? new Date(connection.lastEventAt).toLocaleString("fr-FR") : "—"}
          />
          {connection.lastError ? (
            <Row k="Diagnostic" v={connection.lastError} />
          ) : null}
        </dl>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          Aucun numéro WhatsApp Business n&apos;est connecté à cette entreprise.
        </p>
      )}

      {!canEdit ? (
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          Seul un administrateur ou le propriétaire peut modifier la connexion.
        </p>
      ) : connected && !open ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="dj-btn dj-btn--outline"
            onClick={() => setOpen(true)}
          >
            Reconfigurer
          </button>
          <form action={disconnectAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <SubmitButton variant="outline">Déconnecter</SubmitButton>
          </form>
        </div>
      ) : !open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          {embeddedSignup ? (
            <WhatsAppEmbeddedSignupButton
              organizationId={organizationId}
              appId={embeddedSignup.appId}
              configId={embeddedSignup.configId}
              graphVersion={embeddedSignup.graphVersion}
            />
          ) : null}
          <button
            type="button"
            className="dj-btn dj-btn--outline"
            onClick={() => setOpen(true)}
          >
            {embeddedSignup ? "Connecter manuellement (avancé)" : "Connecter un numéro"}
          </button>
        </div>
      ) : null}

      {disconnectState && !disconnectState.ok ? (
        <Feedback state={disconnectState} />
      ) : null}

      {canEdit && open ? (
        <form
          action={connectAction}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: 18,
            background: "var(--card-alt)",
          }}
        >
          <input type="hidden" name="organizationId" value={organizationId} />

          <Field label="Type de connexion" htmlFor="wa-provider">
            <Select
              id="wa-provider"
              name="provider"
              value={provider}
              onChange={(e) => setProvider(e.currentTarget.value)}
            >
              <option value="META_CLOUD">WhatsApp Cloud API (Meta)</option>
              <option value="MOCK">Mock (développement, aucun appel Meta)</option>
            </Select>
          </Field>

          <Field
            label="Phone Number ID"
            htmlFor="wa-pnid"
            error={fieldError(connectState, "phoneNumberId")}
          >
            <Input id="wa-pnid" name="phoneNumberId" placeholder="1234567890" required />
          </Field>

          <Field label="WABA ID (facultatif)" htmlFor="wa-waba">
            <Input id="wa-waba" name="businessAccountId" placeholder="1029384756" />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Numéro affiché (facultatif)" htmlFor="wa-disp">
              <Input id="wa-disp" name="displayPhoneNumber" placeholder="+223 76 00 00 00" />
            </Field>
            <Field label="Nom vérifié (facultatif)" htmlFor="wa-name">
              <Input id="wa-name" name="verifiedName" placeholder="FEREDRON Commerce" />
            </Field>
          </div>

          {provider === "META_CLOUD" ? (
            <Field
              label="Access token"
              htmlFor="wa-token"
              error={fieldError(connectState, "accessToken")}
              hint="Stocké chiffré. Jamais réaffiché."
            >
              <Input id="wa-token" name="accessToken" type="password" autoComplete="off" />
            </Field>
          ) : null}

          <Feedback state={connectState} />

          <div style={{ display: "flex", gap: 10 }}>
            <SubmitButton>Enregistrer la connexion</SubmitButton>
            <button
              type="button"
              className="dj-btn dj-btn--ghost"
              onClick={() => setOpen(false)}
            >
              Annuler
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <dt style={{ color: "var(--text-3)" }}>{k}</dt>
      <dd className={mono ? "mono" : undefined} style={{ margin: 0, textAlign: "right", wordBreak: "break-all" }}>
        {v}
      </dd>
    </div>
  );
}
