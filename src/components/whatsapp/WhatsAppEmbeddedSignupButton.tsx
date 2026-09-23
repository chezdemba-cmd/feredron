"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { connectWhatsAppEmbeddedAction } from "@/server/actions/whatsapp.actions";
import { Feedback } from "@/components/form";

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (opts: {
        appId: string;
        autoLogAppEvents?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: {
          authResponse?: { code?: string };
          status?: string;
        }) => void,
        opts: {
          config_id: string;
          response_type: "code";
          override_default_response_type: true;
          extras: {
            setup: Record<string, unknown>;
            featureType: string;
            sessionInfoVersion: string;
          };
        },
      ) => void;
    };
  }
}

/**
 * WhatsApp Embedded Signup (SDK Facebook Login for Business) : le commerçant
 * connecte son propre numéro WhatsApp via une fenêtre Meta guidée, sans
 * jamais saisir de Phone Number ID / token à la main. Le "code" renvoyé n'est
 * jamais exploitable côté client — il est échangé côté serveur
 * (`connectWhatsAppEmbeddedAction` → `exchangeSignupCode`).
 */
export function WhatsAppEmbeddedSignupButton({
  organizationId,
  appId,
  configId,
  graphVersion,
}: {
  organizationId: string;
  appId: string;
  configId: string;
  graphVersion: string;
}) {
  const router = useRouter();
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState<"idle" | "waiting" | "error">("idle");
  const sessionRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});
  const [state, dispatch] = useActionState(connectWhatsAppEmbeddedAction, null);

  useEffect(() => {
    if (state?.ok) {
      setStatus("idle");
      router.refresh();
    } else if (state && !state.ok) {
      setStatus("error");
    }
  }, [state, router]);

  // Charge le SDK Facebook une seule fois.
  useEffect(() => {
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion });
      setSdkReady(true);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/fr_FR/sdk.js";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  }, [appId, graphVersion]);

  // Capture phone_number_id / waba_id postés par la fenêtre Embedded Signup.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.event === "FINISH") {
          sessionRef.current = {
            phoneNumberId: data.data?.phone_number_id,
            wabaId: data.data?.waba_id,
          };
        }
      } catch {
        // Messages non-JSON (autres origines facebook.com) — ignorés.
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function launch() {
    if (!window.FB) return;
    setStatus("waiting");
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        const { phoneNumberId, wabaId } = sessionRef.current;
        if (!code || !phoneNumberId || !wabaId) {
          setStatus("idle");
          return;
        }
        const fd = new FormData();
        fd.set("organizationId", organizationId);
        fd.set("code", code);
        fd.set("phoneNumberId", phoneNumberId);
        fd.set("businessAccountId", wabaId);
        dispatch(fd);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        className="dj-btn dj-btn--primary"
        style={{ alignSelf: "flex-start" }}
        disabled={!sdkReady || status === "waiting"}
        onClick={launch}
      >
        {status === "waiting" ? "Connexion en cours…" : "Connecter mon numéro WhatsApp"}
      </button>
      {state && !state.ok ? <Feedback state={state} /> : null}
    </div>
  );
}
