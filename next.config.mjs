/** @type {import('next').NextConfig} */

// CSP « raisonnable » (§33). Les appels aux providers (Meta / LLM / STT) sont
// faits CÔTÉ SERVEUR (fetch Node), donc `connect-src 'self'` suffit pour le
// navigateur. `unsafe-inline` reste nécessaire pour le bootstrap Next et les
// styles inline React ; un durcissement par nonce demanderait un middleware.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // connect.facebook.net : SDK "Facebook Login for Business" (WhatsApp
  // Embedded Signup, Paramètres → WhatsApp) — seul script tiers autorisé.
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net" +
    (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  // graph.facebook.com : requêtes internes du SDK FB (statut de session).
  "connect-src 'self' https://graph.facebook.com",
  // Le SDK FB ouvre un iframe caché (fb_xd_fragment) vers facebook.com pour
  // la communication cross-domain du flux de connexion.
  "frame-src https://www.facebook.com https://web.facebook.com",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // HSTS — forcé hors dev uniquement (inutile sur http://localhost). Les
  // navigateurs ignorent l'en-tête servi en clair, donc sans risque derrière un
  // proxy qui redirige encore http→https. `preload` volontairement omis
  // (engagement irréversible : à activer sciemment le moment venu).
  ...(process.env.NODE_ENV === "development"
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
