import { z } from "zod";

/**
 * Validation centralisée des variables d'environnement.
 * En cas de configuration invalide au démarrage, on échoue clairement
 * plutôt que de laisser une erreur cryptique surgir en production.
 */
const schema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL manquant")
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL doit être une URL PostgreSQL",
    }),
  AUTH_SESSION_SECRET: z
    .string()
    .min(32, "AUTH_SESSION_SECRET doit faire au moins 32 caractères"),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DEFAULT_COUNTRY_CODE: z.string().min(2).max(2).default("ML"),
  DEFAULT_CURRENCY: z.string().min(3).max(3).default("XOF"),
  DEFAULT_TIMEZONE: z.string().min(1).default("Africa/Bamako"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Environnement logique de déploiement (indépendant de NODE_ENV de Next). */
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),

  // ── Phase 5 : WhatsApp Business Cloud API (plateforme Djeli) ──
  // Facultatifs : sans eux, le provider « mock » reste utilisable en dev/test.
  // Les credentials PAR ORGANISATION (Phone Number ID, token…) vivent en base
  // (chiffrés), pas ici.
  WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, "Format attendu : vXX.X (ex : v21.0)")
    .default("v21.0"),
  META_APP_ID: z.string().min(1).optional(),
  META_APP_SECRET: z.string().min(1).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
  /** Configuration Embedded Signup (App Meta → WhatsApp → Embedded Signup). */
  META_EMBEDDED_SIGNUP_CONFIG_ID: z.string().min(1).optional(),
  /** Clé de chiffrement des tokens WhatsApp — 32 octets en base64 ou hex. */
  WHATSAPP_TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),

  // ── Phase 6 : Djeli IA ──
  // Sans configuration, le provider « mock » (déterministe, aucune API) reste
  // utilisable. La clé API n'est jamais exposée au frontend ni journalisée.
  AI_PROVIDER: z.enum(["mock", "openai-compatible"]).default("mock"),
  AI_API_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(20_000),
  AI_MAX_TOKENS: z.coerce.number().int().positive().max(8192).default(700),
  /** inline = traité en tâche différée dans le process ; queue = à brancher. */
  AI_DISPATCH: z.enum(["inline", "queue"]).default("inline"),
  /** Réponses AUTO WhatsApp max par conversation et par minute (anti-boucle). */
  AI_AUTO_MAX_PER_MIN: z.coerce.number().int().positive().max(60).default(4),

  // ── Phase 6B : Djeli Voice ──
  // Sans configuration, le provider « mock » (déterministe, aucune API) suffit.
  VOICE_PROVIDER: z.enum(["mock", "openai-compatible", "bambara-hf", "kooma"]).default("mock"),
  VOICE_API_KEY: z.string().min(1).optional(),
  VOICE_BASE_URL: z.string().url().optional(),
  VOICE_MODEL: z.string().min(1).default("whisper-1"),
  VOICE_TIMEOUT_MS: z.coerce.number().int().positive().max(180_000).default(30_000),
  VOICE_MAX_FILE_MB: z.coerce.number().positive().max(64).default(16),
  /** En dessous : Djeli IA demande une clarification ou fait un handoff. */
  VOICE_LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  VOICE_DISPATCH: z.enum(["inline", "queue"]).default("inline"),

  // ── Phase 6C : Djeli Language Core ──
  // Secret du client API de démonstration (DJELI_BUSINESS) posé par le seed —
  // uniquement pour tester `/api/v1/language/*` en local. Le connecteur
  // in-process du Business Assistant n'en a PAS besoin.
  LANGUAGE_DEMO_CLIENT_SECRET: z.string().min(8).optional(),

  // ── Phase 6D : Djeli Learning Loop (seuils de proposition, jamais d'auto-GLOBAL) ──
  LEARNING_MIN_OCCURRENCES: z.coerce.number().int().positive().max(1000).default(3),
  LEARNING_MIN_ORGANIZATIONS: z.coerce.number().int().positive().max(1000).default(3),
  LEARNING_MIN_CORRECTIONS: z.coerce.number().int().positive().max(1000).default(2),
  LEARNING_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.35),
  /** Seuil (jours) sans nouvelle occurrence → candidat marqué STALE. */
  LEARNING_STALE_DAYS: z.coerce.number().int().positive().max(3650).default(120),

  // ── Phase 7 : automatisations, assistant proactif, marketing ──
  // DETECT → RECOMMEND → PREPARE → CONFIRM → EXECUTE. Rien d'externe en auto.
  /** inline = passe déclenchée à la demande dans le process ; cron = route interne ; queue = via JobQueue. */
  AUTOMATION_DISPATCH: z.enum(["inline", "cron", "queue"]).default("inline"),
  /** Secret attendu par POST /api/internal/automations/run (header x-automation-secret). */
  AUTOMATION_CRON_SECRET: z.string().min(16).optional(),
  /** Jours sans commande livrée avant de considérer un client inactif (§12). */
  AUTOMATION_INACTIVE_CUSTOMER_DAYS: z.coerce.number().int().positive().max(3650).default(60),
  /** Anti-répétition : heures avant de recréer la même recommandation (§37). */
  AUTOMATION_RECOMMENDATION_COOLDOWN_HOURS: z.coerce.number().int().positive().max(720).default(24),
  /** Heures avant qu'une commande PENDING_CONFIRMATION soit signalée (§14). */
  AUTOMATION_ORDER_PENDING_HOURS: z.coerce.number().int().positive().max(240).default(2),
  /** Heures avant qu'une commande PREPARING / OUT_FOR_DELIVERY soit signalée bloquée (§15). */
  AUTOMATION_ORDER_STUCK_HOURS: z.coerce.number().int().positive().max(720).default(48),
  /** Jours avant échéance pour « paiement bientôt dû » (§11). */
  PAYMENT_DUE_SOON_DAYS: z.coerce.number().int().positive().max(60).default(3),
  /** Nombre max de tentatives d'un job avant passage en DEAD (§34). */
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
  /** Plafond d'items envoyés par campagne (garde-fou anti-spam, §24). 0 = pas de plafond. */
  MARKETING_MAX_RECIPIENTS: z.coerce.number().int().nonnegative().max(100_000).default(0),

  // ── E-mail transactionnel (réinitialisation de mot de passe, §R2) ──
  /** "mock" (dev/test : journalise, n'envoie rien) ou "resend" (API REST). */
  EMAIL_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  /** Clé API du provider e-mail. Jamais exposée au frontend ni journalisée. */
  EMAIL_API_KEY: z.string().min(1).optional(),
  /** Expéditeur des e-mails transactionnels (ex : "FEREDRON <no-reply@feredron.app>"). */
  EMAIL_FROM: z.string().min(3).default("FEREDRON <no-reply@feredron.app>"),
  /** Autorise explicitement EMAIL_PROVIDER=mock en production (déconseillé). */
  EMAIL_ALLOW_MOCK_IN_PROD: z.enum(["0", "1"]).default("0"),
  /** Durée de validité d'un lien de réinitialisation de mot de passe (minutes). */
  PASSWORD_RESET_TTL_MIN: z.coerce.number().int().positive().max(1440).default(60),
  /** Demandes de réinitialisation autorisées par IP et par minute. */
  PASSWORD_RESET_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().max(60).default(5),

  // ── Phase 8 : production, monétisation, pilote ──
  /** Autorise explicitement AI_PROVIDER=mock en production (déconseillé). */
  AI_ALLOW_MOCK_IN_PROD: z.enum(["0", "1"]).default("0"),
  /** Autorise explicitement VOICE_PROVIDER=mock en production (déconseillé). */
  VOICE_ALLOW_MOCK_IN_PROD: z.enum(["0", "1"]).default("0"),
  /** Autorise l'exécution du seed de démonstration hors développement. */
  ALLOW_DEMO_SEED: z.enum(["0", "1"]).default("0"),
  /**
   * Topologie de déploiement. `single` (défaut, décision pilote) : une seule
   * instance applicative — le rate-limit mémoire + le verrou de compte suffisent.
   * `multi` : plusieurs instances → un rate-limit partagé est OBLIGATOIRE.
   */
  DEPLOYMENT_TOPOLOGY: z.enum(["single", "multi"]).default("single"),
  /** Backend du rate-limit : "memory" (mono-instance) ou "redis" (partagé). */
  RATE_LIMIT_STORE: z.enum(["memory", "redis"]).default("memory"),
  /** URL Redis (rate-limit partagé / file de production). ex : redis://host:6379 */
  REDIS_URL: z.string().min(1).optional(),
  /** Verbosité du logger structuré. */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** DSN Sentry (ou équivalent) — capture d'erreurs. Optionnel. */
  SENTRY_DSN: z.string().url().optional(),
  /** Durée d'essai par défaut d'un nouvel abonnement (jours). */
  TRIAL_DAYS: z.coerce.number().int().positive().max(365).default(14),
  /** Fournisseur de facturation : "manual" (pilote) ou "stripe". */
  BILLING_PROVIDER: z.enum(["manual", "stripe"]).default("manual"),
  /** E-mails autorisés dans la console opérateur /admin (séparés par des virgules). */
  DJELI_SUPERADMIN_EMAILS: z.string().optional(),
  /** Tentatives de connexion autorisées par IP et par minute. */
  LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().max(120).default(10),
  /** Créations de compte autorisées par IP et par minute (anti-abus / anti-énumération). */
  REGISTER_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().max(60).default(5),

  // ── Staging / démo (seed-staging.ts) — jamais actif en production ──
  /** Mots de passe des comptes de test DEMO. Fallback dev documenté si absents. */
  DEMO_OWNER_PASSWORD: z.string().min(1).optional(),
  DEMO_ADMIN_PASSWORD: z.string().min(1).optional(),
  DEMO_MANAGER_PASSWORD: z.string().min(1).optional(),
  DEMO_SALES_PASSWORD: z.string().min(1).optional(),
  DEMO_EMPLOYEE_PASSWORD: z.string().min(1).optional(),
  /** Autorise une organisation `isDemo` à déclencher un envoi externe réel. Défaut : NON. */
  DEMO_ALLOW_EXTERNAL_SEND: z.enum(["true", "false"]).default("false"),

  // ── Phase 9 : mobile / PWA / natif ──
  /** Feature flags mobile (inlinés au build ; lus aussi côté client). */
  NEXT_PUBLIC_PWA_ENABLED: z.string().optional(),
  NEXT_PUBLIC_MOBILE_NATIVE: z.string().optional(),
  NEXT_PUBLIC_PUSH_NOTIFICATIONS: z.string().optional(),
  /** Identité de l'app native (§45). */
  MOBILE_APP_ID: z.string().min(3).default("com.djeli.business"),
  APP_VERSION: z.string().default("0.9.0"),
  BUILD_NUMBER: z.coerce.number().int().nonnegative().default(1),
  /** URLs que le shell natif peut charger (§91). Pas de localhost en dur. */
  STAGING_API_URL: z.string().url().optional(),
  PRODUCTION_API_URL: z.string().url().optional(),
  /** URL forcée pour le build Capacitor courant (sinon PRODUCTION_API_URL puis STAGING_API_URL). */
  CAP_SERVER_URL: z.string().url().optional(),
  /** Clé publique VAPID pour le Web Push (§33). */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

// Les hébergeurs peuvent importer les variables facultatives avec une valeur
// vide. Les traiter comme absentes permet aux valeurs par défaut de s'appliquer.
// Conserver les valeurs non vides telles quelles, notamment les secrets.
function environmentInput() {
  return Object.fromEntries(
    Object.entries(process.env).map(([key, value]) => [
      key,
      value?.trim() === "" ? undefined : value,
    ]),
  );
}

/**
 * true si l'environnement LOGIQUE de déploiement est « production ».
 * Volontairement indépendant du `NODE_ENV` de Next (qui vaut "production"
 * pendant `next build`, ce qui n'est pas un déploiement).
 */
export function isProduction(env?: Pick<Env, "APP_ENV">): boolean {
  const e = env ?? cached;
  if (e) return e.APP_ENV === "production";
  return process.env.APP_ENV === "production";
}

/**
 * Garde-fous de production (§12, §54). Empêche le démarrage si un provider
 * « mock » est actif en production sans autorisation explicite, ou si le
 * rate-limit Redis est demandé sans URL.
 */
export function productionGuardIssues(env: Env): string[] {
  if (!isProduction(env)) return [];
  const issues: string[] = [];
  if (env.AI_PROVIDER === "mock" && env.AI_ALLOW_MOCK_IN_PROD !== "1") {
    issues.push(
      "AI_PROVIDER=mock interdit en production (définir un vrai provider ou AI_ALLOW_MOCK_IN_PROD=1).",
    );
  }
  if (env.AI_PROVIDER === "openai-compatible" && !env.AI_API_KEY) {
    issues.push("AI_PROVIDER=openai-compatible exige AI_API_KEY.");
  }
  if (env.VOICE_PROVIDER === "mock" && env.VOICE_ALLOW_MOCK_IN_PROD !== "1") {
    issues.push(
      "VOICE_PROVIDER=mock interdit en production (définir un vrai provider ou VOICE_ALLOW_MOCK_IN_PROD=1).",
    );
  }
  if (env.VOICE_PROVIDER === "openai-compatible" && !env.VOICE_API_KEY) {
    issues.push("VOICE_PROVIDER=openai-compatible exige VOICE_API_KEY.");
  }
  if (env.VOICE_PROVIDER === "bambara-hf" && !env.VOICE_BASE_URL) {
    issues.push("VOICE_PROVIDER=bambara-hf exige VOICE_BASE_URL (endpoint du service bambara).");
  }
  if (env.VOICE_PROVIDER === "kooma" && !env.VOICE_API_KEY) {
    issues.push("VOICE_PROVIDER=kooma exige VOICE_API_KEY.");
  }
  if (env.WHATSAPP_PROVIDER === "mock" && process.env.WHATSAPP_ALLOW_MOCK_IN_PROD !== "1") {
    issues.push(
      "WHATSAPP_PROVIDER=mock interdit en production (WHATSAPP_PROVIDER=meta ou WHATSAPP_ALLOW_MOCK_IN_PROD=1).",
    );
  }
  if (env.WHATSAPP_PROVIDER === "meta") {
    if (!env.WHATSAPP_TOKEN_ENCRYPTION_KEY) {
      issues.push("WHATSAPP_PROVIDER=meta exige WHATSAPP_TOKEN_ENCRYPTION_KEY.");
    }
    if (!env.META_APP_SECRET) {
      issues.push("WHATSAPP_PROVIDER=meta exige META_APP_SECRET.");
    }
    if (!env.META_WEBHOOK_VERIFY_TOKEN) {
      issues.push("WHATSAPP_PROVIDER=meta exige META_WEBHOOK_VERIFY_TOKEN.");
    }
  }
  if (env.RATE_LIMIT_STORE === "redis") {
    // L'adaptateur Redis n'est pas encore implémenté (cf. server/ratelimit/store.ts) :
    // en production, retomber silencieusement sur la mémoire donnerait une fausse
    // impression de rate-limit partagé multi-instance.
    issues.push(
      "RATE_LIMIT_STORE=redis : adaptateur Redis non implémenté (retombée mémoire silencieuse). " +
        "Utiliser 'memory' (déploiement mono-instance) ou fournir l'implémentation Redis.",
    );
  }
  if (env.ALLOW_DEMO_SEED === "1") {
    issues.push("ALLOW_DEMO_SEED=1 en production : le seed de démonstration ne doit jamais tourner en prod.");
  }
  if (env.DEPLOYMENT_TOPOLOGY === "multi" && env.RATE_LIMIT_STORE !== "redis") {
    issues.push(
      "DEPLOYMENT_TOPOLOGY=multi exige un rate-limit partagé (RATE_LIMIT_STORE=redis) : " +
        "le store mémoire ne protège qu'une instance à la fois.",
    );
  }
  if (env.EMAIL_PROVIDER === "mock" && env.EMAIL_ALLOW_MOCK_IN_PROD !== "1") {
    issues.push(
      "EMAIL_PROVIDER=mock interdit en production (la réinitialisation de mot de passe " +
        "n'enverrait rien) : configurer un vrai provider ou EMAIL_ALLOW_MOCK_IN_PROD=1.",
    );
  }
  if (env.EMAIL_PROVIDER === "resend" && !env.EMAIL_API_KEY) {
    issues.push("EMAIL_PROVIDER=resend exige EMAIL_API_KEY.");
  }
  return issues;
}

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(environmentInput());
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Variables d'environnement invalides :\n${details}\n\n` +
        "Copiez .env.example vers .env et complétez les valeurs.",
    );
  }
  const guardIssues = productionGuardIssues(parsed.data);
  if (guardIssues.length > 0) {
    throw new Error(
      `Configuration de production invalide :\n${guardIssues.map((i) => `  - ${i}`).join("\n")}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * Validation « souple » utilisée par le script check:env — retourne le rapport
 * sans jeter, pour un affichage lisible.
 */
export function inspectEnv(): { ok: boolean; issues: string[] } {
  const parsed = schema.safeParse(environmentInput());
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const guardIssues = productionGuardIssues(parsed.data);
  return { ok: guardIssues.length === 0, issues: guardIssues };
}
