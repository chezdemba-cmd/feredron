/**
 * Générateur de secrets de production FEREDRON (§35, Action 4).
 * Utilise le CSPRNG natif de Node.js (crypto.randomBytes).
 *
 * Exécution :
 *   npm run gen:secrets
 */
import { randomBytes } from "node:crypto";

function generateSecrets() {
  const authSessionSecret = randomBytes(48).toString("base64url");
  const automationCronSecret = randomBytes(32).toString("hex");
  const whatsappKeyHex = randomBytes(32).toString("hex");
  const whatsappKeyB64 = randomBytes(32).toString("base64");
  const metaWebhookVerifyToken = randomBytes(24).toString("hex");

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  FEREDRON — Secrets cryptographiques générés pour la PRODUCTION  ");
  console.log("═══════════════════════════════════════════════════════════════════\n");
  console.log("# À copier dans vos variables d'environnement de production :");
  console.log("# (sur Vercel, Railway, Render, Fly.io, Kubernetes ou .env prod)\n");
  console.log(`AUTH_SESSION_SECRET="${authSessionSecret}"`);
  console.log(`AUTOMATION_CRON_SECRET="${automationCronSecret}"`);
  console.log(`WHATSAPP_TOKEN_ENCRYPTION_KEY="${whatsappKeyHex}"`);
  console.log(`META_WEBHOOK_VERIFY_TOKEN="${metaWebhookVerifyToken}"\n`);
  console.log("───────────────────────────────────────────────────────────────────");
  console.log("Notes :");
  console.log("• AUTH_SESSION_SECRET : 64 octets (base64url) — HMAC-SHA256 pour JWT");
  console.log("• AUTOMATION_CRON_SECRET : 32 octets (hex) — Protection routes internes");
  console.log("• WHATSAPP_TOKEN_ENCRYPTION_KEY : 32 octets (64 hex) — AES-256-GCM");
  console.log("  (Variante base64 équivalente : " + whatsappKeyB64 + ")");
  console.log("• META_WEBHOOK_VERIFY_TOKEN : Jeton à renseigner dans la console Meta");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

generateSecrets();
