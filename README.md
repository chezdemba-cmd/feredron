# FEREDRON

**Votre commercial, partout avec vous.**

Commercial IA pour aider les commerçants à vendre davantage, simplement, sur tous leurs canaux.
d'Afrique de l'Ouest.

**État : Phase 9 — Mobile-first + PWA + shell natif (Capacitor) prêt.**

> **Mobile (Phase 9)** : navigation basse (Accueil · Commandes · Djeli · Clients ·
> Plus), action centrale « Parler à Djeli », listes en **cartes** sur mobile
> (commandes / clients / stock / créances), actions terrain sur la fiche client
> (Appeler / WhatsApp / Itinéraire), quick actions d'accueil. **PWA** installable
> (`manifest`, service worker, icônes, page `/offline`, bandeau réseau). **Deep
> links** `djeli://order/123` + allowlist de navigation WebView. Machine à états
> **Voice** (`IDLE…LOW_CONFIDENCE…FAILED`). **Capacitor** retenu (mode *remote
> hosted*) : `capacitor.config.ts`, scripts `mobile:sync|android|ios`, env
> `MOBILE_APP_ID`/`APP_VERSION`/`*_API_URL`. Le `cap add android/ios` + les
> builds APK/AAB/IPA sont documentés (`docs/MOBILE-ARCHITECTURE.md`, `PWA.md`,
> `ANDROID-BUILD.md`, `IOS-BUILD.md`, `MOBILE-QA.md`, `ANDROID-STORE.md`,
> `IOS-STORE.md`) — non exécutables ici (pas de SDK Android / macOS).

**État antérieur : Phase 8 terminée + environnement STAGING / DÉMO.**

> **Staging / démo** : `APP_ENV=staging` + `npm run demo:seed` crée l'organisation
> « FEREDRON DEMO COMMERCE » (`isDemo=true`) — 5 comptes de rôles, ~20 produits
> (états de stock variés), ~18 clients, 16 commandes (tous statuts + créances par
> tranche), conversations WhatsApp mock FR/BM/MIXED, recommandations + résumé du
> jour. Bannière « ENVIRONNEMENT DE DÉMONSTRATION » partout, envoi externe
> interdit pour les orgs `isDemo`. `npm run demo:reset` (avec
> `DEMO_RESET_CONFIRM=DJELI-DEMO`) réinitialise **uniquement** l'org démo.
> `npm run smoke` vérifie `/api/health` + `/api/readiness` avant de livrer l'URL.
> Docs : `docs/STAGING-DEPLOYMENT.md`, `TEST-ACCOUNTS.md`, `TEST-SCENARIOS.md`,
> `TESTER-GUIDE.md`.

- Phase 1 : auth, multi-tenant, organisations, membres, rôles (RBAC), onboarding,
  audit, un seul OWNER par organisation, téléphones E.164.
- Phase 2 : catégories, produits (prix entiers, SKU unique par organisation),
  **stock dérivé d'événements** — physique / réservé / disponible, mouvements
  immuables, inventaire, mouvements compensatoires.
- Phase 3 : **clients / CRM** (périmètre de visibilité par rôle), **commandes**
  (référence séquentielle, machine de transition centralisée, historique de
  statuts, snapshots de prix), **réservation de stock** à la création,
  libération à l'annulation, **mouvement `SALE`** à la livraison, verrou
  `SELECT … FOR UPDATE` anti-survente concurrente.
- Phase 4 : **paiements** (`Payment`, entiers, jamais supprimés → statut
  `CANCELLED`), **créance dérivée** (`balanceDue = totalAmount − Σ paiements
  CONFIRMED`, aucun modèle `Debt`), **ventes à crédit** (`Order.dueDate`),
  statut de paiement **dérivé** (`derivePaymentStatus`, l'UI ne choisit jamais),
  **surpaiement interdit** (y compris concurrent, verrou `FOR UPDATE` sur la
  ligne `orders`), tranches d'ancienneté serveur, page `/debts`, sections
  paiement réelles sur fiche commande & fiche client, **relances** préparées
  (`ReminderCampaign` / `…Item`, gabarit de message) — **envoi simulé, WhatsApp
  non connecté**.
- Phase 5 : **WhatsApp Business Cloud API** — `WhatsAppConnection` par
  organisation (token **chiffré** AES-256-GCM), webhook `/api/webhooks/whatsapp`
  (handshake GET + **signature `X-Hub-Signature-256`** obligatoire),
  **idempotence** sur `(organizationId, externalMessageId)`, tenant résolu par
  Phone Number ID, **identification / création client** (source `WHATSAPP`),
  `Conversation` + `Message`, réponse humaine depuis l'app via un **provider
  abstrait** (`mock` / `meta`), statuts `SENT/DELIVERED/READ` sans régression,
  **fenêtre de service 24 h**, modes **AUTO / HUMAIN / EN PAUSE** (AUTO ne
  répond pas — préparé pour la Phase 6), assignation + périmètre SALES.

- Phase 6 : **Djeli IA** — provider LLM abstrait (`mock` / `openai-compatible`),
  prompt système central **versionné**, classification d'intention + niveau de
  **confiance** qui pilote la politique (`LOW→handoff`, `MEDIUM→prudent`,
  `HIGH→réponse auto lecture seule`), **couche de capacités** (l'IA n'appelle
  jamais Prisma ni ne génère de SQL — uniquement une liste blanche d'outils
  tenant + RBAC-scopés), principal **SYSTEM_AI** à permissions figées et
  restreintes, **OrderDraft** (aucune `Order` ni réservation sans
  `READ→REASON→PROPOSE→CONFIRM→EXECUTE`), conversion via le moteur `createOrder`
  existant, `AiActionProposal` pour les actions write de l'assistant `/ai`,
  pipeline AUTO déclenché **après** la réponse au webhook, idempotence par
  `AiRun` unique, handoff sur faible confiance / audio / fenêtre fermée /
  demande client. **Aucune action de paiement ni d'ajustement de stock par
  l'IA.**

- Phase 6B : **Djeli Voice** — messages vocaux WhatsApp et enregistrement
  micro dans `/ai`. `VoiceProvider` abstrait (`mock` déterministe /
  `openai-compatible` `/audio/transcriptions`), pipeline **AUDIO → download
  Meta → transcription → détection langue (FR / BM / MIXED / UNKNOWN) → Djeli
  IA**, `VoiceTranscription` (une par message, `originalText` jamais écrasé,
  `effectiveText = correctedText ?? originalText`), **correction humaine**
  conservée pour le futur Djeli Language Core, transcription **hors requête
  webhook** (`VoiceJobDispatcher`), confiance basse → clarification / handoff,
  bambara et code-switching **non traduits de force**. Politique MVP : l'audio
  **n'est pas conservé**.

- Phase 6C : **Djeli Language Core Foundation** — brique linguistique
  **indépendante et réutilisable** (BM / FR / MIXED), séparée du métier
  (`src/language-core/`, tables `language_*` sans FK vers les tables métier).
  Modèle `LanguageEntry` + variants / translations / intents / examples /
  prononciation / révisions ; scopes **GLOBAL / DOMAIN / ORGANIZATION** ;
  cycle **OBSERVED → SUGGESTED → VALIDATED → REJECTED → ARCHIVED** ; API
  versionnée **`/api/v1/language`** (auth par `ApplicationClient`, secret haché,
  rate-limit) ; moteur `resolve` (priorité ORG → DOMAIN → GLOBAL, VALIDATED
  seulement) ; observations & corrections (**jamais** de promotion GLOBAL
  automatique) ; **anonymisation PII** avant tout partage ; export
  JSON/JSONL/CSV (GLOBAL+DOMAIN VALIDATED, sans PII) ; import → SUGGESTED ;
  connecteur **tolérant aux pannes** (`languageCore`) branché en lecture dans le
  pipeline Voice→IA et pour les corrections de transcription.

- Phase 6D : **Djeli Learning Loop** — `OBSERVATION → CORRECTION → CLUSTER →
  LEARNING CANDIDATE → HUMAN REVIEW → SUGGESTED → VALIDATED`. Agrégateur
  **déterministe** (règles, aucun ML/embedding/vecteur) → `LearningCandidate`
  idempotents (`dedupeKey`), score de confiance **explicité** (pas de score
  opaque), `scopeSuggestion` prudent (1 org → ORGANIZATION, non anonymisable →
  ORGANIZATION, GLOBAL = multi-domaines + forte diversité + revue renforcée),
  distinction `occurrenceCount` / `organizationCount`, preuves **anonymisées**
  (`organizationHash`, jamais l'id), détection de **conflit** avant promotion
  (aucune fusion auto), promotion → `LanguageEntry` **SUGGESTED** (jamais
  `VALIDATED`, jamais `GLOBAL` automatiquement — invariant testé), file de revue
  `/language/learning`, replay d'impact, dataset builder JSONL/CSV (candidats
  APPROVED/PROMOTED, shareable, ré-anonymisés), signal **no-match** et
  idempotence des observations (`idempotencyKey`). Permission `language.review`
  (revue) distincte de `language.validate` (validation finale).

- Phase 7 : **Automatisations + Marketing + Assistant proactif** —
  `DETECT → RECOMMEND → PREPARE → CONFIRM → EXECUTE` (jamais
  `DETECT → EXECUTE` pour une action sensible ou externe). Détecteurs
  **déterministes** adossés aux services métier réels : stock faible / rupture,
  créances en retard, échéance proche, clients inactifs, opportunités,
  commandes à confirmer / bloquées / à préparer, résumé quotidien →
  `BusinessRecommendation` **dédupliquées** (`dedupeKey` = org + type + entité +
  période) avec **cooldown**, et **expirées** automatiquement quand le problème
  disparaît. `AutomationRule` (config + activation, jeu par défaut à
  l'onboarding, **aucune règle à effet externe ON par défaut**), `AutomationRun`
  tracé, `AutomationScheduler` (abstraction : route interne / worker / queue).
  **Assistant proactif** (« Djeli a détecté N points à surveiller ») sur le
  dashboard et `/ai`. **Marketing** : `MarketingCampaign` DRAFT → READY
  (approbation humaine) → SENDING → SENT/PARTIAL, audience résolue par règles
  simples (inactifs, type, zone, produit), **opt-out toujours exclu**, aperçu
  d'audience (inclus / exclus / message / template), **idempotence d'envoi** par
  `(campaignId, customerId)`, fenêtre 24 h → texte de session, hors fenêtre →
  **template approuvé uniquement** sinon item sauté. Réutilise le service
  WhatsApp et `ReminderCampaign` existants — **aucun nouveau client Meta, aucun
  second moteur de relance**. `JobQueue` (abstraction + adapter in-process,
  retry avec backoff borné → `DEAD`), centre de **notifications** in-app.
  Permissions `automations.read/manage`, `marketing.read/manage/send`,
  `recommendations.read` (SALES : périmètre restreint).

- Phase 8 : **Production + Monétisation + Pilote** — pas de nouveau module
  métier. **Garde-fous de production** (`APP_ENV=production` refuse les providers
  `mock` et le seed de démo sans autorisation explicite). **Sessions** :
  révocation globale (`sessionInvalidBefore`, « déconnecter tous les appareils »,
  suspension, appareil compromis). **Rate-limit** : abstraction `RateLimitStore`
  (mémoire + adapter Redis à fournir) ; connexion limitée par IP. **Queue** :
  handlers `AI_PROCESS` / `VOICE_TRANSCRIBE` / `WHATSAPP_SEND` + enqueue si
  `*_DISPATCH=queue` ; **worker** séparé (`npm run worker`) + `maintenance`
  (expiration réservations / brouillons / propositions, essais échus).
  **Monétisation** : `Plan` (STARTER / BUSINESS / PRO), `Subscription`
  (TRIAL → ACTIVE / PAST_DUE / CANCELLED / SUSPENDED), **feature gating** central
  (`hasFeature`), **usage metering** (`UsageCounter`) + `checkUsageLimit` avant
  chaque appel coûteux (IA, Voice, marketing) — refus = **zéro dépense
  fournisseur**. **Console opérateur** `/admin` (offre, usage, statut WhatsApp,
  incidents — **aucun contenu privé**). **Support** (`SupportTicket` + `/support`)
  et **feedback** global. **Export** CSV/JSON des données (OWNER) et **demande de
  suppression** d'organisation avec période de grâce. **En-têtes de sécurité**
  (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy). **Observabilité** :
  logger JSON structuré, hook Sentry, `/api/health` enrichi + `/api/readiness`.
  **CI** GitHub Actions (env, migrate deploy + status, typecheck, tests DB, build).
  Onboarding pilote dynamique + indicateur d'activation ; flags `isPilot` /
  `isDemo`. Docs : `docs/PRODUCTION*.md`, `WHATSAPP-SETUP.md`, `BACKUPS.md`,
  `SECRETS-ROTATION.md`, `PILOT.md`.

Aucun entraînement (ASR / LLM / fine-tuning / RL) n'est réalisé. **Aucune
application mobile native.**

La source de vérité visuelle est `Djeli Business Assistant vb.html` (fourni
séparément). Tokens extraits dans `docs/mockup/DESIGN-TOKENS.md`. Aucun redesign.

---

## Stack

| Domaine | Choix |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript strict |
| Base de données | PostgreSQL + Prisma 6 (`engineType = "binary"`) |
| Auth | Session cookie JWT signé (`jose`, HS256) + `bcryptjs` |
| Validation | Zod |
| Tests | `node:test` (runner natif Node ≥ 22) |
| Styles | CSS + `next/font` (Caprasimo / Figtree), tokens de la maquette |

Aucune dépendance native `.node` requise à l'exécution côté app (le moteur
Prisma tourne en sous-processus).

---

## Démarrage

### 1. Prérequis

- Node.js ≥ 22 (testé sur Node 24)
- Une base **PostgreSQL** (Supabase, Neon, Docker local, …)

### 2. Installation

```bash
npm install
```

### 3. Variables d'environnement

```bash
cp .env.example .env
# Éditer .env : DATABASE_URL (obligatoire) + AUTH_SESSION_SECRET (≥ 32 car.)

# Démarrer PostgreSQL local (écoute uniquement sur 127.0.0.1:5433)
docker compose up -d postgres

# Initialiser le schéma et les comptes de démonstration
npm run prisma:deploy
npm run db:seed
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # génère un secret
npm run check:env   # valide la configuration
```

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Chaîne PostgreSQL (`postgresql://…`) — **obligatoire** |
| `AUTH_SESSION_SECRET` | Secret de signature des sessions, ≥ 32 caractères — **obligatoire** |
| `AUTH_SESSION_TTL_DAYS` | Durée de session (défaut 30) |
| `NEXT_PUBLIC_APP_URL` | URL publique (liens d'invitation) — défaut `http://localhost:3000` |
| `DEFAULT_COUNTRY_CODE` / `DEFAULT_CURRENCY` / `DEFAULT_TIMEZONE` | Défauts organisation (`ML` / `XOF` / `Africa/Bamako`) |
| `WHATSAPP_PROVIDER` | `mock` (défaut, dev/test) ou `meta` (Cloud API). `mock` refusé en prod sauf `WHATSAPP_ALLOW_MOCK_IN_PROD=1` |
| `META_GRAPH_API_VERSION` | Version API Graph, centralisée — défaut `v23.0` |
| `META_APP_ID` / `META_APP_SECRET` | App Meta (plateforme). `META_APP_SECRET` requis pour accepter les webhooks POST |
| `META_WEBHOOK_VERIFY_TOKEN` | Jeton du handshake GET du webhook |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | Clé AES-256-GCM (32 octets base64/hex) pour chiffrer les tokens en base |
| `AI_PROVIDER` | `mock` (déterministe, sans API — défaut) ou `openai-compatible` |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | Fournisseur LLM (clé jamais exposée ni journalisée) |
| `AI_TIMEOUT_MS` / `AI_MAX_TOKENS` | Garde-fous appel LLM (défaut 20000 / 700) |
| `AI_DISPATCH` | `inline` (traitement différé in-process — défaut) ou `queue` (à brancher) |
| `AI_AUTO_MAX_PER_MIN` | Réponses AUTO WhatsApp / conversation / minute (anti-boucle, défaut 4) |
| `VOICE_PROVIDER` | `mock` (déterministe, sans API — défaut) ou `openai-compatible` |
| `VOICE_API_KEY` / `VOICE_BASE_URL` / `VOICE_MODEL` | Service speech-to-text (`/audio/transcriptions`) — clé jamais exposée |
| `VOICE_TIMEOUT_MS` / `VOICE_MAX_FILE_MB` | Garde-fous transcription (défaut 30000 / 16) |
| `VOICE_LOW_CONFIDENCE_THRESHOLD` | Sous ce seuil, Djeli IA clarifie / fait un handoff (défaut 0.55) |
| `VOICE_DISPATCH` | `inline` (différé in-process — défaut) ou `queue` (à brancher) |
| `LANGUAGE_DEMO_CLIENT_SECRET` | Secret du client API de démo `djeli-business` (seed) — pour tester `/api/v1/language/*` en local |
| `LEARNING_MIN_OCCURRENCES` / `LEARNING_MIN_ORGANIZATIONS` / `LEARNING_MIN_CORRECTIONS` / `LEARNING_MIN_CONFIDENCE` | Seuils de **proposition** du Learning Loop (défauts 3 / 3 / 2 / 0.35) — ne déclenchent jamais de promotion |
| `LEARNING_STALE_DAYS` | Jours sans nouvelle occurrence → candidat marqué `stale` (défaut 120) |
| `AUTOMATION_DISPATCH` | `inline` (passe à la demande — défaut), `cron` (route interne) ou `queue` (via `JobQueue`) |
| `AUTOMATION_CRON_SECRET` | Secret de `POST /api/internal/automations/run` et `/api/internal/jobs/run` (header `x-automation-secret`) |
| `AUTOMATION_INACTIVE_CUSTOMER_DAYS` / `AUTOMATION_RECOMMENDATION_COOLDOWN_HOURS` / `AUTOMATION_ORDER_PENDING_HOURS` / `AUTOMATION_ORDER_STUCK_HOURS` / `PAYMENT_DUE_SOON_DAYS` | Seuils par défaut des détecteurs (60 / 24 / 2 / 48 / 3) — surchargés par la config de chaque règle |
| `JOB_MAX_ATTEMPTS` | Tentatives d'un job avant `DEAD` (défaut 3) |
| `MARKETING_MAX_RECIPIENTS` | Plafond de destinataires par campagne, garde-fou anti-spam (0 = illimité) |
| `APP_ENV` | `development` / `staging` / `production` — environnement **logique** (indépendant du `NODE_ENV` de Next) |
| `AI_ALLOW_MOCK_IN_PROD` / `VOICE_ALLOW_MOCK_IN_PROD` | `1` pour autoriser un provider `mock` en `APP_ENV=production` (déconseillé) |
| `ALLOW_DEMO_SEED` | `1` pour autoriser `db:seed` en production (jamais en pratique) |
| `RATE_LIMIT_STORE` / `REDIS_URL` | `memory` (défaut) ou `redis` (partagé multi-instance) + URL |
| `LOGIN_RATE_LIMIT_PER_MIN` | Tentatives de connexion par IP et par minute (défaut 10) |
| `LOG_LEVEL` / `SENTRY_DSN` | Verbosité du logger structuré ; DSN de suivi d'erreurs (optionnel) |
| `TRIAL_DAYS` | Durée d'essai d'un nouvel abonnement (défaut 14) |
| `BILLING_PROVIDER` | `manual` (pilote) ou `stripe` (abstraction `BillingProvider`) |
| `DJELI_SUPERADMIN_EMAILS` | E-mails autorisés dans la console opérateur `/admin` (+ flag `User.isSuperAdmin`) |

### 4. Base de données

```bash
npm run prisma:generate      # client Prisma
npm run prisma:deploy        # applique prisma/migrations (production / CI)
# —— ou en développement, pour créer/rejouer les migrations ——
npm run prisma:migrate

npm run db:seed              # DONNÉES DE DÉV UNIQUEMENT (jamais en production)
```

Le seed crée l'entreprise **Djeli Commerce Demo** :

| Email | Rôle | Mot de passe |
|---|---|---|
| `moussa@djeli.demo` | OWNER | `password123` |
| `awa@djeli.demo` | ADMIN | `password123` |
| `ibrahim@djeli.demo` | MANAGER | `password123` |
| `fatou@djeli.demo` | SALES | `password123` |
| `oumar@djeli.demo` | EMPLOYEE | `password123` |

### 5. Lancer

```bash
npm run dev        # http://localhost:3000
npm run build && npm run start   # production
```

### 6. Vérifications

```bash
npm run typecheck   # tsc --noEmit
npm run test        # node:test — RBAC + isolation multi-tenant + helpers
curl localhost:3000/api/health   # { status, db }
```

---

## Architecture

```
src/
  app/
    (auth)/            login, register
    (onboarding)/      onboarding (créer entreprise), onboarding/team (inviter)
    (app)/             layout = coquille (sidebar + topbar) + garde auth/tenant
      dashboard/       réel : user, entreprise, rôle, checklist, audit, tuiles stock /
                       activité du jour / créances en retard / encaissements du jour
      members/         réel : membres, rôles, invitations
      settings/        réel : paramètres entreprise
      profile/         réel : profil + mot de passe
      catalog/         réel : liste, [id], [id]/edit, new  (recherche/filtres/pagination serveur)
      stock/           réel : niveaux, movements (historique paginé), new (mouvement/inventaire)
      customers/       réel : liste (scopée), [id] (+ créances), [id]/edit, new
      orders/          réel : Kanban + liste filtrée, [id] (+ paiements), [id]/edit, new
      debts/           réel : vue d'ensemble + tranches + liste filtrée/paginée (scopée)
      reminders/       réel : campagnes de relance, [id] (aperçu + envoi simulé)
      conversations/   réel : liste scopée + filtres, [id] (fil + composer + modes + assignation
                       + badge « Djeli IA » + bandeau handoff + carte « Commande proposée »
                       + bloc « Message vocal » : transcription, langue, corriger / réessayer)
      ai/              réel : assistant métier (questions → cartes de données, propositions
                       confirmables) + bouton micro (MediaRecorder → transcription → question)
    invite/[token]/    acceptation d'invitation (public)
    forbidden/         écran d'accès refusé
    api/health/ · api/catalog/search   sonde · recherche produit (formulaire commande)
    api/webhooks/whatsapp/   webhook Meta (GET handshake + POST signé, public)
  middleware.ts        garde légère (présence cookie) — /api/* NON couvert (webhook public)
  server/
    auth/              password (bcrypt), session (jose), current-user
    tenant/            context, access-policy (pur), ownership (un seul OWNER)
    rbac/              permissions (matrice rôles), guard (requirePermission)
    stock/             movement-rules (pur), sku (pur), stock-service (agrégats), reservations
    crm/               scope (périmètre par rôle, pur), customer-service (stats)
    orders/            order-status (machine, pur), pricing (pur), reference (pur), order-service
    finance/           payment-rules (pur), reminder-template (pur), payment-service,
                       finance-service (agrégats créances), reminder-service
    whatsapp/          crypto (AES-256-GCM), signature (HMAC), service-window, message-status,
                       conversation-mode, webhook-parser, scope (purs) ; provider (mock/meta),
                       client (Graph API), connection/conversation/inbound/status/message-service
    ai/                intents, confidence, language, schema (Zod), system-prompt (versionné),
                       mock-provider (purs) ; provider (mock/openai-compatible), capabilities
                       (liste blanche tenant+RBAC), principal (SYSTEM_AI), turn, run-service,
                       order-draft-service, proposal-service, assistant-service,
                       whatsapp-ai-service, dispatcher
    voice/             provider-types, mock-provider, language-detection, effective-text (purs) ;
                       provider (mock/openai-compatible), audio-service (download Meta),
                       transcription-service, voice-job-dispatcher
    language/          language-core-client (connecteur tolérant aux pannes)
    audit/             writeAuditLog
    actions/           Server Actions (…, payments, reminders, whatsapp, ai, voice, language-admin)
    validation/        schémas Zod
    errors.ts          AppError + messages utilisateur (jamais d'erreur SQL brute)
  language-core/       SERVICE SÉPARÉ (tables language_*, aucune FK métier) :
                       normalize / scope-priority / sanitize / permissions (purs) ;
                       entry / resolve-engine / search / observation / export / import / auth ;
                       learning/ : config / scoring / scope-suggestion / dedupe / invariants (purs) ;
                                   aggregator / conflict / review / promotion / dataset-builder /
                                   replay / metrics / queries ; api-helpers ; README + gouvernance
  app/api/v1/language/  Language API versionnée (resolve, search, entries, validate,
                       domains, exports, openapi.json, learning/*)
  app/(app)/language/  UI admin interne (perm language.admin / language.review) : dashboard,
                       entries + éditeur, suggestions, learning (queue + détail), domains,
                       applications, import/export
  lib/                 env, identifiers (E.164), format, labels, tz (fuseau org), result
  server/automations/  Phase 7 — détecteurs (stock / créances / clients / commandes / résumé),
                       recommendation-service (dédupe + cooldown + expiration), automation-service
                       (passe + AutomationRun), scheduler, proactive, daily-digest ; modules purs
                       (rules / priority / inactivity / recommendation-key / scope)
  server/marketing/    campaign-service (DRAFT→READY→SENT, garde-fous 24 h / template / opt-out /
                       idempotence), audience-service + audience-rules, consent, content
  server/jobs/         JobQueue (abstraction + adapter in-process), retry (backoff borné), handlers
  server/notifications/ notification-service (centre in-app, périmètre par rôle)
  server/billing/      plans / features / limits (purs) ; subscription-service, usage-service
                       (checkUsageLimit / recordUsage), guard (hasFeature / requireFeature),
                       ai-gate, entitlements, billing-provider (Manual)
  server/admin/        superadmin (pur), guard (requireSuperAdmin), console-service
  server/observability/ error-tracking (hook Sentry)
  server/ratelimit/    memory-store (pur), store (sélection memory|redis)
  server/maintenance/  cleanup (expiration réservations / drafts / propositions / essais)
  server/support/ · server/org/ · server/onboarding/ · server/analytics/
  app/(app)/           + billing, support ; app/(admin)/admin (console opérateur isolée)
  app/{privacy,terms,data-processing}/  pages légales (placeholders)
  app/api/internal/    automations/run, jobs/run, maintenance/run (secret x-automation-secret)
  app/api/{health,readiness}/   sondes de déploiement
  scripts/worker.ts    process de fond (jobs + scheduler + maintenance)
  .github/workflows/ci.yml   pipeline CI
prisma/                schema.prisma, migrations/ (0001..0012), seed.ts
tests/                 rbac, tenant-isolation, ownership, identifiers, stock-rules, sku,
                       order-status, order-pricing, crm-scope, tz, payment-rules,
                       reminder-template, whatsapp-* (signature / service-window /
                       message-status / webhook-parser / crypto / scope), conversation-mode,
                       ai-* (confidence / principal / schema / mock-provider),
                       voice-* (language-detection / effective-text / mock-provider),
                       language-* (normalize / scope-priority / sanitize / permissions),
                       learning-* (scoring / scope-suggestion / dedupe / invariants),
                       automation-* (recommendation-key / priority / inactivity / scope / rules),
                       marketing-* (consent / audience-rules), job-retry,
                       billing-* (plans / features / limits), session-invalidation,
                       ratelimit-store, admin-superadmin, env-production-guards, logger,
                       *.integration (orders / payments / whatsapp / ai / voice / language /
                       language-learning / automations-marketing / e2e-full / e2e-tenant
                       — skip sans RUN_DB_TESTS)
```

### Sécurité multi-tenant

Toute donnée liée à une organisation passe par
`requireOrganizationAccess(userId, organizationId)` qui charge le
`OrganizationMember` via la **clé unique `(organizationId, userId)`**. Un
`organizationId` venant du client est **toujours** re-validé côté serveur.
La décision d'accès est isolée dans `access-policy.ts` (fonction pure, couverte
par `tests/tenant-isolation.test.ts`).

### RBAC

`src/server/rbac/permissions.ts` définit le catalogue de permissions et la
matrice par rôle (`OWNER > ADMIN > MANAGER > SALES > EMPLOYEE`). Chaque action
sensible appelle `requirePermission(role, permission)` côté serveur ; l'UI
masque en complément et affiche `ForbiddenPanel` si le rôle n'a pas l'accès.

---

## Réel vs mocké

**Réel (connecté PostgreSQL)** : auth, organisations, membres, invitations,
paramètres, audit · **catalogue** · **stock** (physique/réservé/disponible,
mouvements, inventaire) · **clients / CRM** · **commandes** (cycle de vie,
réservations, livraison → `SALE`) · **créances / paiements** (solde dérivé,
statut dérivé, surpaiement interdit, ventes à crédit, échéances, tranches
d'ancienneté) · **relances** (campagnes préparées, gabarit de message, **envoi
simulé**) · **WhatsApp / conversations** (webhook signé + idempotent,
identification client, fil de messages, réponse humaine via provider `mock`/`meta`,
statuts, fenêtre 24 h, modes AUTO/HUMAIN/PAUSE, assignation) · **Djeli IA**
(compréhension du message, outils de lecture tenant + RBAC-scopés, réponse AUTO
sur WhatsApp, brouillons de commande, assistant métier `/ai`, handoff) · **Djeli
Voice** (vocaux WhatsApp → transcription → langue FR/BM/MIXED → Djeli IA,
correction humaine, micro dans `/ai`) · **Djeli Language Core** (modèle
linguistique, API `/api/v1/language`, scopes GLOBAL/DOMAIN/ORGANIZATION, resolve
priorisé, validation/versioning, export sans PII, connecteur tolérant aux
pannes, UI admin `/language`) · tuiles stock + « activité du jour » + « créances
en retard » + « encaissements du jour » du dashboard (fuseau de l'organisation).

**Encore mocké / préparé mais inactif** :

- **Provider LLM réel** : `AI_PROVIDER=mock` par défaut (déterministe, sans
  API). Passer `openai-compatible` + `AI_API_KEY`/`AI_BASE_URL` pour brancher un
  vrai modèle — aucune autre ligne à changer.
- **Provider speech-to-text réel** : `VOICE_PROVIDER=mock` par défaut. Passer
  `openai-compatible` + `VOICE_API_KEY`/`VOICE_BASE_URL` pour un vrai moteur.
- **Envoi WhatsApp réel des campagnes / relances** : dépend de
  `WHATSAPP_PROVIDER=meta` + numéro connecté. En `mock` (défaut), `sendCampaign`
  parcourt toute la logique (audience, opt-out, fenêtre 24 h, template,
  idempotence) mais le provider renvoie un identifiant factice.
- **Planification automatique** : `scripts/worker.ts` (process séparé,
  `npm run worker`) frappe périodiquement `/api/internal/{jobs,automations,maintenance}/run`.
  Sur plateforme serverless : cron externe sur ces trois routes. En dev, bouton
  « Analyser maintenant » sur `/automations`.
- **File de jobs de production** (BullMQ / Redis) : `JobQueue` est une
  abstraction ; l'adapter in-process (table `jobs`) est actif. Les handlers
  `AI_PROCESS` / `VOICE_TRANSCRIBE` / `WHATSAPP_SEND` existent ; les dispatchers
  enfilent quand `AI_DISPATCH` / `VOICE_DISPATCH = queue`, sinon `setImmediate`.
- **Rate-limit partagé** : `RateLimitStore` (mémoire par défaut). Un adapter
  Redis reste à fournir pour le multi-instance (`RATE_LIMIT_STORE=redis`).
- **Facturation** : `BILLING_PROVIDER=manual` (pilote). L'abstraction
  `BillingProvider` est prête pour Stripe / PayDunya / CinetPay / Orange Money / Wave.
- **Suivi d'erreurs** : `installErrorTracking()` branche Sentry si `SENTRY_DSN`
  (ajouter `@sentry/node`) ; sinon log structuré `level:error`.
- **Base staging réelle, tests `RUN_DB_TESTS=1`, Redis, sauvegardes, load smoke**
  : hors de cet environnement (pas de Postgres). Prêts et documentés
  (`docs/PRODUCTION*.md`, `BACKUPS.md`, CI).
- **Entraînement de modèle** (ASR / LLM / fine-tuning / embeddings / vector DB /
  RL) : hors périmètre. Le Learning Loop (6D) produit un **dataset** exportable
  (candidats revus, anonymisés) pour une évaluation future, mais n'entraîne rien
  et ne fait **aucune promotion automatique** — chaque candidat est approuvé
  puis promu en `SUGGESTED` par un humain, puis validé séparément.
- **Provider linguistique** : le connecteur `languageCore` appelle le Core
  **in-process**. Le passage à un service HTTP séparé (`/api/v1/language`)
  n'exigera que de remplacer l'implémentation du connecteur.
- **Envoi réel des relances** : `ReminderCampaign` marque les lignes en
  *simulation*. `whatsapp/message-service` expose déjà `sendTemplate()` ; le
  branchement `ReminderCampaign → sendTemplate` (avec templates approuvés)
  viendra plus tard.
- **Conservation de l'audio** : politique MVP = le binaire n'est **pas** stocké
  (téléchargé, transcrit, jeté). Aucune synthèse vocale (TTS) en sortie.
- **File d'attente IA / Voice** : `AI_DISPATCH` / `VOICE_DISPATCH` = `inline`
  (tâche différée in-process).
  `queue` est un point d'extension non implémenté.
- **Embedded Signup Meta** : la connexion se fait par saisie manuelle
  (Phone Number ID / WABA ID / token) — cf. §7 ci-dessous.
- Envoi réel des invitations (aujourd'hui : lien à copier)
- Authentification téléphone / OTP (structure prête, non branchée)

---

## Dette technique

### Sessions (JWT stateless)

- **Aujourd'hui** : la session est un JWT signé stocké en cookie, sans table
  de sessions. Un jeton **ne peut pas être révoqué individuellement** avant son
  expiration (déconnexion d'un appareil précis, blocage immédiat d'un vol de
  cookie).
- **Changement de mot de passe** : géré via une **révocation douce**. `User`
  porte `passwordChangedAt` ; `getCurrentUser()` rejette toute session émise
  avant cette date (tolérance de 2 s), et `changePasswordAction` ré-émet une
  session fraîche pour l'appareil courant. Effet : changer son mot de passe
  déconnecte **toutes** les autres sessions. La désactivation d'un compte
  (`User.status = DISABLED`) est également prise en compte à chaque requête.
- **Avant production, recommandé** : soit une table `Session`
  (`id`, `userId`, `expiresAt`, `revokedAt`, `userAgent`, `ip`) avec un
  `sessionId` dans le JWT et vérification en base (permet la révocation ciblée
  et « déconnecter partout »), soit une liste de révocation courte durée
  (Redis) indexée par `jti`. Garder `passwordChangedAt` comme filet.

### CRM & commandes (Phase 3)

- **Concurrence / survente** : `order-service` verrouille les lignes `products`
  concernées (`SELECT … FOR UPDATE`, ordre trié → pas de deadlock) AVANT le
  contrôle de disponibilité et la création des réservations, dans la même
  transaction. Deux créations concurrentes pour un même produit sont
  sérialisées par PostgreSQL. Tests d'intégration DB : `tests/orders.integration.test.ts`
  (skip sans `RUN_DB_TESTS=1` + base de test).
- **Édition d'une commande** (NEW / PENDING_CONFIRMATION) : les réservations
  ACTIVE sont **libérées puis reprises** avec re-contrôle du disponible, dans
  une transaction. Pas de diff incrémental fin des réservations.
- **Périmètre CRM** : SALES / EMPLOYEE ne voient que leurs clients assignés et
  leurs commandes (créées par eux ou de clients assignés) — `src/server/crm/scope.ts`,
  appliqué en `where` serveur ET en garde d'action. OWNER / ADMIN / MANAGER : tout.
- **Référence de commande** : `OrderCounter.lastNumber` incrémenté par `upsert`
  dans la transaction de création. Course théorique sur la toute première
  commande d'une organisation (violation d'unicité PK → l'utilisateur relance).
- Kanban : chargement plafonné à 200 commandes ouvertes ; au-delà, utiliser la
  vue liste filtrée.
- Livraison : `fulfillReservation` crée un mouvement `SALE` par réservation ;
  la baisse du stock physique intervient **à la livraison**, pas à la réservation.

### Créances, paiements & relances (Phase 4)

- **Créance dérivée** : aucun modèle `Debt`. `balanceDue = totalAmount −
  Σ(paiements CONFIRMED)`. `Order.amountPaid` et `Order.paymentStatus` sont un
  **cache** recalculé dans chaque transaction de paiement / annulation /
  changement d'échéance ; la vérité reste les lignes `Payment`.
- **Statut de paiement dérivé** : `derivePaymentStatus(total, payé,
  {creditMode})` (pur, `src/server/finance/payment-rules.ts`). L'UI ne choisit
  jamais le statut.
- **Surpaiement interdit** : `assertWithinBalance` refuse tout encaissement > au
  solde restant. En concurrence, `payment-service` verrouille la ligne `orders`
  (`SELECT id FROM "orders" WHERE id = $1 FOR UPDATE`) **avant** de resommer les
  paiements CONFIRMED et de contrôler le dépassement, dans la même transaction :
  deux paiements simultanés de 80 000 sur un solde de 100 000 → un seul réussit,
  `amountPaid` final = 80 000, jamais 160 000.
- **Créance recouvrable** : commande `DELIVERED` **et** `balanceDue > 0`. **En
  retard** : en plus, `dueDate != null` et `dueDate < now`. Échéance nulle →
  jamais « en retard » automatiquement.
- **Tranches d'ancienneté** (À échoir, 1–7, 8–30, 31–60, 61–90, 90+) calculées
  serveur. `/debts` et la vue d'ensemble chargent l'ensemble borné des créances
  livrées non soldées puis filtrent / paginent en mémoire — suffisant à
  l'échelle MVP ; repasser en agrégat SQL (vue ou colonne cache) au-delà de
  quelques milliers de créances ouvertes.
- **Annulation d'un paiement** : jamais de suppression → `status = CANCELLED` +
  `cancelledAt` / `cancelledByUserId` / `cancellationReason`, solde recalculé,
  audit obligatoire. Un paiement CONFIRMED ne s'édite pas : annuler + ré-saisir.
- **Périmètre SALES** : `debts.write` accordé à SALES, mais l'action vérifie en
  plus `canActOnOrder` / `canAccessCustomer` — un SALES n'encaisse et ne relance
  que dans son périmètre CRM (Phase 3).
- **Relances** : `ReminderCampaign` + `ReminderCampaignItem` (montant dû et
  message **snapshotés** à la préparation). « Envoyer » = passer les lignes en
  `SENT` en **mode simulation** (libellé explicite à l'écran) — aucun message
  WhatsApp réel. Gabarit pur `reminder-template.ts`.
- Tests d'intégration DB : `tests/payments.integration.test.ts` (skip sans
  `RUN_DB_TESTS=1` + base) — paiement partiel, surpaiement refusé, annulation,
  créance / non-créance, concurrence, multi-tenant, périmètre SALES, relances.

### WhatsApp & conversations (Phase 5)

- **Secrets** : l'access token Meta n'est **jamais** stocké en clair
  (`whatsapp/crypto.ts`, AES-256-GCM, clé `WHATSAPP_TOKEN_ENCRYPTION_KEY`). Il
  n'apparaît ni dans les logs, ni dans l'audit, ni dans les erreurs, ni côté
  client — `getConnectionForOrg` renvoie une vue « safe » sans le token.
- **Webhook** `/api/webhooks/whatsapp` : GET = handshake
  (`META_WEBHOOK_VERIFY_TOKEN`) ; POST = **signature `X-Hub-Signature-256`
  obligatoire** (HMAC `META_APP_SECRET`, comparaison à temps constant). Sans
  `META_APP_SECRET` configuré → 503. Signature invalide → 401.
- **Idempotence** : unique `(organizationId, externalMessageId)` sur `messages`.
  Un webhook redélivré ne crée jamais de doublon (Message, Customer,
  Conversation, CustomerActivity). Une erreur transitoire renvoie 500 → Meta
  redélivre, l'idempotence protège.
- **Tenant** : `processWhatsAppWebhook` résout `phone_number_id →
  WhatsAppConnection → Organization`. Jamais de déduction depuis le numéro
  client. Un Phone Number ID inconnu → événement ignoré (200), rien créé.
- **Provider abstrait** (`whatsapp/provider.ts`) : `mock` (dev/test, aucun
  appel Meta) ou `meta` (Graph API, version `META_GRAPH_API_VERSION`
  centralisée). `mock` **refusé en production** sauf
  `WHATSAPP_ALLOW_MOCK_IN_PROD=1`.
- **Fenêtre 24 h** : `sendConversationMessage` refuse le texte libre si
  `isCustomerServiceWindowOpen(lastInboundAt)` est faux (message : « modèle
  approuvé nécessaire »). Pas de gestionnaire de templates complet en Phase 5 ;
  `message-service` expose déjà `sendText()` / `sendTemplate()` pour la suite.
- **AUTO → HUMAN** : dès qu'un humain répond dans une conversation en AUTO, le
  mode bascule en HUMAN (empêchera l'IA de la Phase 6 de répondre par-dessus).
- **Rate-limit webhook** : `whatsapp/rate-limit.ts`, en mémoire, **par
  instance** — « best effort ». Pour du multi-instance, passer à un store
  partagé (Redis).
- **Réponse webhook synchrone** : le traitement est fait dans la requête (pas
  de file). Volume MVP OK ; un découpage en file (BullMQ/Redis) est prévu si le
  débit l'exige — non déployé.
- **Connexion = saisie manuelle** (§7 du prompt) : Phone Number ID / WABA ID /
  token saisis dans Paramètres → WhatsApp. Le modèle et le service sont conçus
  pour remplacer cela par l'**Embedded Signup Meta** sans refonte métier
  (mêmes champs `WhatsAppConnection`).
- Tests d'intégration DB : `tests/whatsapp.integration.test.ts` (skip sans
  `RUN_DB_TESTS=1`) — §50 webhook inbound + idempotence, §51 client existant,
  §52 multi-tenant, §53 outbound, §54 échec d'envoi, §55 statuts sans
  régression, §56 périmètre SALES.

### Djeli IA (Phase 6)

- **READ → REASON → PROPOSE → CONFIRM → EXECUTE** : l'IA ne fait jamais
  directement une action sensible. Les brouillons (`OrderDraft`) ne créent ni
  `Order` ni réservation ; la conversion passe par `createOrder` (prix serveur,
  verrous, stock). Les actions write de l'assistant `/ai` produisent une
  `AiActionProposal` à confirmer.
- **Aucune action de paiement ni d'ajustement de stock par l'IA** — même avec
  confirmation (MVP). `SYSTEM_AI` n'a pas `debts.*`, ni aucun `*.write` hors
  `conversations.write`.
- **Couche de capacités** (`ai/capabilities.ts`) : l'IA choisit un `toolName`
  d'une liste blanche ; jamais de SQL/JS. `organizationId` vient du contexte,
  jamais des `args` du modèle (un `organizationId` dans `args` est ignoré).
  Chaque tool re-vérifie permission + périmètre SALES ; `runCapability` refuse
  tool inconnu / permission manquante **avant** toute lecture.
- **Prompt injection** : la vraie barrière est côté tools serveur. Même si le
  modèle demande une opération interdite, le tool renvoie `FORBIDDEN`.
- **Confiance** (`ai/confidence.ts`, pur) : `LOW → handoff`, `MEDIUM → réponse
  prudente sans écriture`, `HIGH → réponse auto (lecture seule) + brouillon
  autorisé`. Fenêtre 24 h fermée, message non textuel, demande d'humain →
  handoff (`Conversation.mode → HUMAN`, `CustomerActivity AI_HANDOFF`).
- **Idempotence** : `AiRun` unique `(messageId, WHATSAPP_AUTO_REPLY)` — un
  message INBOUND rejoué par Meta ne produit qu'une réponse. `OrderDraft`
  unique `(conversationId, sourceMessageId)`.
- **Latence webhook** : le pipeline IA est déclenché **après** la réponse 200
  (dispatcher `inline` → `setImmediate`). En serverless le worker peut être
  interrompu ; l'idempotence rend un rejeu sûr. `AI_DISPATCH=queue` est prévu
  pour un worker séparé (non implémenté).
- **Anti-boucle** : seul un `Message` INBOUND client déclenche l'AUTO ; les
  sortants (dont ceux de l'IA) non. Rate-limit `AI_AUTO_MAX_PER_MIN` par
  conversation → dépassement = handoff.
- **Provider** : `ai/mock-provider.ts` (déterministe, testable, sans API) /
  `openai-compatible` (`/chat/completions`, `response_format: json_object`,
  timeout `AI_TIMEOUT_MS`). Sortie **validée par Zod** (`ai/schema.ts`) ; sortie
  cassée → plan « handoff » sûr. `AI_PROMPT_VERSION` enregistré dans `AiRun`.
- **Traçabilité** : `AiRun` (intent, confidence, tokens, latence, handoff) +
  `AiToolCall` (résumés courts) — **jamais** le raisonnement interne du modèle
  ni les prompts complets. `Message.generatedByAi` + `aiRunId`.
- **Bambara** : `ai/language.ts` détecte FR/BM/AUTO (heuristique) et le passe au
  provider ; aucune garantie de traduction.
- Tests d'intégration DB : `tests/ai.integration.test.ts` (skip sans
  `RUN_DB_TESTS`) — §63–§75 (produit, brouillon, confirmation, approbation,
  stock modifié, hallucination, injection, tenant, RBAC interne, AUTO/HUMAN,
  idempotence, confiance basse, fenêtre 24 h).

### Djeli Voice (Phase 6B)

- **Pipeline** : `AUDIO inbound → dispatchVoiceJob (setImmediate, hors requête
  Meta) → download média Meta → VoiceProvider.transcribe → detectVoiceLanguage
  → si conversation AUTO : dispatchInboundAi`. Le webhook répond 200 sans
  attendre la transcription (§35, §37).
- **`VoiceTranscription`** : `@@unique([messageId])` — une transcription active
  par vocal (§53). `originalText` **jamais écrasé** ; `effectiveText =
  correctedText ?? originalText` (maintenu à la création et à la correction) —
  c'est ce texte qui part à Djeli IA (§13, §17). Retranscription seulement sur
  action explicite « Réessayer » ; bloquée si déjà corrigée à la main.
- **Langues** : `voice/language-detection.ts` (pur) combine la suggestion du
  moteur et des heuristiques → `FR / BM / MIXED / UNKNOWN`. Le bambara et le
  code-switching **ne sont pas traduits de force** ; `MIXED` est conservé
  (§6, §22, §23). `normalizeVoiceText` = nettoyage doux, l'original reste roi.
- **Confiance basse** (`confidence < VOICE_LOW_CONFIDENCE_THRESHOLD`) → Djeli IA
  fait un **handoff** avec message de clarification, **aucune action sensible**
  (§20, §52).
- **Audio** : téléchargé côté serveur (token WhatsApp jamais exposé/loggé),
  transmis au provider, **puis jeté** — aucun binaire ni URL persisté (§10,
  §16). Gardes taille (`VOICE_MAX_FILE_MB`) et type MIME.
- **Micro `/ai`** : `MediaRecorder` → `transcribeAppAudioAction` (éphémère,
  aucune ligne DB) → texte pré-rempli, l'utilisateur vérifie avant d'envoyer
  (§27–§30).
- **Multi-tenant / RBAC** : `VoiceTranscription` strictement org-scopée ;
  correction / retranscription = `conversations.write` + périmètre conversation
  (§49, §55, §56). Aucun nouveau système RBAC.
- **Provider** : `voice/mock-provider.ts` (déterministe, lit le buffer — JSON
  ou texte brut, aucun réseau) / `openai-compatible`
  (`POST {base}/audio/transcriptions`, `verbose_json`, timeout).
- **Frontière Language Core** : `VoiceTranscription` est une donnée
  opérationnelle. Les corrections sont conservées pour un **export futur** vers
  le Djeli Language Core (avec consentement / anonymisation / rétention /
  séparation tenant ↔ global) — rien n'est copié automatiquement (§42–§44).
- Tests d'intégration DB : `tests/voice.integration.test.ts` (skip sans
  `RUN_DB_TESTS`) — §45–§54.

### Djeli Language Core (Phase 6C)

Documentation détaillée : **`src/language-core/README.md`** (data model,
gouvernance, privacy, format d'export).

- **Indépendance** : `src/language-core/` ne référence **aucune** table métier
  (`organizationId` / `createdByRef` / `applicationCode` = chaînes). Un seul
  point de couplage : `db.ts`. Audit, auth et API propres.
- **OBSERVATION ≠ SUGGESTION ≠ VALIDÉ** : `resolve` standard ne sert que
  `VALIDATED`. **Aucune correction ne crée une entrée GLOBAL VALIDATED
  automatiquement** — l'agrégation est la Phase 6D
  (`learning-candidate-service.ts` = matière première seulement).
- **Scopes** : `GLOBAL` / `DOMAIN` / `ORGANIZATION`. Priorité de résolution
  **ORG → DOMAIN → GLOBAL**, puis exact → variante → fuzzy (`scope-priority.ts`,
  pur). Une entrée `ORGANIZATION` n'est jamais promue automatiquement et n'est
  visible que pour son organisation.
- **API v1** (`/api/v1/language`) : auth `Authorization: Bearer <clientId>.<secret>`
  (secret **bcrypt**, jamais en clair), permissions par `ApplicationClient`
  (`language.read/write/validate/export` + `.organization.*`), rate-limit
  240/min/client. `401` invalide · `403` permission · `429` débit. OpenAPI :
  `GET /api/v1/language/openapi.json`.
- **Normalisation** (`normalize.ts`, pur) : casse / apostrophes / espaces /
  ponctuation de bord. **Diacritiques bambara et accents conservés** — l'original
  (`canonicalText`) est toujours stocké.
- **Vie privée** : `sanitize.ts` masque e-mail / téléphone / `CMD-xxxx` /
  nombres longs. Ce qui garde un risque résiduel n'est **pas** marqué partageable.
- **Export** (`export-service.ts`) : JSON / JSONL / CSV. Défaut `GLOBAL + DOMAIN`,
  `VALIDATED`, **sans PII, sans observations brutes, sans données ORGANIZATION**
  (celles-ci exigent `language.organization.read` + `organizationId`).
- **Import** (`import-service.ts`) : CSV/JSON → `SUGGESTED` (jamais `VALIDATED`).
  `LanguageDatasetSource` exige une **licence**.
- **Versioning** : `LanguageEntryRevision` à chaque changement (`version`,
  `snapshot`, `changedByRef`, `changeReason`).
- **Connecteur** (`src/server/language/language-core-client.ts`) : interface
  stable (`resolveExpression` / `searchLanguageEntry` / `submitObservation` /
  `submitCorrection`), **appel in-process** aujourd'hui, **HTTP possible demain**
  sans changer les appelants. **Tolérant aux pannes** : si le Core échoue, chaque
  méthode renvoie un résultat neutre et le Business Assistant continue (pipeline
  Voice / Djeli IA existant = référence). Branché en LECTURE dans
  `whatsapp-ai-service` (enrichissement optionnel) et pour `submitCorrection`
  quand un humain corrige une transcription vocale.
- **UI admin** `/language` (permission `language.admin`, OWNER/ADMIN) : dashboard,
  entrées + éditeur (variants / traductions / intents / provenance / révisions),
  suggestions (validate/reject), domaines, applications, import/export,
  candidats 6D. Données de seed marquées **DEV/DEMO** (§66-67 : aucun bambara
  inventé — les exemples BM/MIXED viennent du seed Phase 6B et restent
  `SUGGESTED`).
- Tests d'intégration DB : `tests/language.integration.test.ts` (skip sans
  `RUN_DB_TESTS`) — §50–§58.

### Learning Loop (Phase 6D)

Documentation détaillée : `src/language-core/README.md`.

- **Invariant central** (`learning/invariants.ts`, testé) : *aucune donnée ne
  devient GLOBAL VALIDATED automatiquement*. `promoteLearningCandidate` vise
  **toujours** `SUGGESTED` (`assertPromotionStatus` rejette VALIDATED / GLOBAL /
  OBSERVED). Le passage à `VALIDATED` reste `language.validate` (humain, séparé).
- **Agrégateur déterministe** (`learning/aggregator.ts`) : regroupe corrections
  et observations no-match par `(norm(original) → norm(corrected), langue)` ;
  classe en `NEW_ENTRY` / `VARIANT` / `NORMALIZATION_PATTERN` (recouvrement de
  tokens ≥ 60 %). `recomputeLearningCandidates()` est **idempotent** (`upsert`
  sur `dedupeKey`, reconstruit les preuves). Un statut décidé par un humain
  (APPROVED/REJECTED/PROMOTED/IGNORED) n'est jamais écrasé par un recompute.
- **Scoring** (`learning/scoring.ts`, pur) : formule bornée [0,1] **documentée** ;
  `explainScore` liste les facteurs (X corrections, Y organisations, récence…) —
  jamais de score opaque pour le reviewer.
- **`scopeSuggestion`** (`learning/scope-suggestion.ts`, pur) : 1 organisation →
  `ORGANIZATION` ; non anonymisable (`shareable=false`) → `ORGANIZATION` quelle
  que soit la fréquence (§53) ; `DOMAIN` = plusieurs organisations, 1 domaine,
  seuils atteints ; `GLOBAL` = multi-domaines + forte diversité + revue
  renforcée. `occurrenceCount` ≠ `organizationCount` (§8).
- **Privacy gate** : preuves anonymisées (`organizationHash`, jamais
  l'`organizationId` en clair) ; une correction sans `sanitizedText` (PII
  résiduelle) force `shareable=false`. Observations idempotentes
  (`idempotencyKey` = hash `app|org|sourceReference`, §49), `sourceReference`
  reste une **chaîne opaque** (le Core n'accède pas aux tables métier, §50).
- **Conflit** (`learning/conflict.ts`) : avant promotion, si une `LanguageEntry`
  de même forme existe déjà (sens différent ou déjà VALIDATED) → candidat
  `CONFLICT`, `conflictEntryId` renseigné, promotion **refusée** (aucune fusion
  automatique, §40, §58).
- **Signal no-match** : quand `languageCore.resolveExpression` renvoie
  `matched:false` dans le pipeline IA, une observation `resolvedMatchType:"NONE"`
  est soumise (best-effort, dédupée). Nourrit le Learning Loop (§12, §13).
- **Dataset builder** (`learning/dataset-builder.ts`) : JSONL / CSV, uniquement
  candidats `APPROVED`/`PROMOTED` `shareable`, texte **ré-anonymisé**, champ
  `datasetSplit` optionnel. Prêt pour une évaluation ASR/LLM future (WER/CER) —
  **aucun entraînement** (§29–§32, §62).
- **Replay** (`learning/replay.ts`) : simule `resolve` sur des échantillons
  avant/après le candidat (§39).
- **RBAC** : `language.review` (approuver / rejeter / promouvoir / recompute) —
  OWNER/ADMIN ; distinct de `language.validate`. Une application métier
  (`DJELI_BUSINESS`) ne reçoit **jamais** `language.review` (§46, §47) : elle
  ne fait que `submitObservation` / `submitCorrection`.
- **API** : `GET /learning/candidates`, `GET /learning/candidates/:id`,
  `POST /learning/recompute`, `POST /learning/candidates/:id/{approve,reject,promote}`,
  `GET /learning/stats`. **UI** : `/language/learning` (file + filtres + tuiles) et
  `/language/learning/[id]` (facteurs de score, preuves anonymisées, édition,
  décisions, replay, historique).
- Tests d'intégration DB : `tests/language-learning.integration.test.ts` (skip
  sans `RUN_DB_TESTS`) — §51–§61, §63.

### Automatisations & Marketing (Phase 7)

- **Principe** : `DETECT → RECOMMEND → PREPARE → CONFIRM → EXECUTE`. Aucun
  détecteur n'exécute d'action ; il décrit un fait. Toute action à impact
  externe ou métier passe par une confirmation humaine sur l'écran cible.
- **Détecteurs** (`server/automations/detectors.ts`) : un par type de règle,
  adossés aux services réels (`stock-service`, `finance-service`, `Order`,
  `Customer`). Chacun renvoie des `DetectedRecommendation` ; `automation-service`
  les persiste via `upsertRecommendations` (dédupe + cooldown) puis
  `expireResolvedRecommendations` (le problème disparu → `EXPIRED`).
- **Déduplication** (`recommendation-key.ts`, pur, testé) :
  `dedupeKey = type | entité | période`, unique par organisation ; `cooldownUntil`
  empêche la recréation immédiate (§36-37). Un `DISMISSED` n'est jamais
  ressuscité automatiquement.
- **Priorités** (`priority.ts`, pur, testé) : seuils métier simples
  (stock faible = MEDIUM, rupture = HIGH, créance 90 j + gros montant =
  CRITICAL…) — pas de score opaque (§6, §54).
- **Périmètre** (`scope.ts`, pur, testé) : OWNER/ADMIN/MANAGER voient toute
  l'organisation ; SALES/EMPLOYEE seulement les recommandations dont
  `ownerUserId` est le leur (§41, §42, §66).
- **Règles** (`rules.ts`, pur, testé) : `RULE_META` (nom, description, config par
  défaut, `defaultEnabled`), `ensureDefaultRules` à l'onboarding.
  `INACTIVE_CUSTOMER` / `SALES_OPPORTUNITY` / `PAYMENT_DUE_SOON` **OFF** par
  défaut ; **aucune règle à effet externe automatique** (§58, §59).
- **Assistant proactif** (`proactive.ts`) : agrège les recommandations ouvertes
  en « Djeli a détecté N points à surveiller aujourd'hui » (dashboard + `/ai`).
  `daily-digest.ts` calcule le résumé du jour — chiffres 100 % services métier,
  jamais le LLM (§18, §45).
- **Marketing** : `campaign-service.ts` — `createCampaign` (DRAFT),
  `previewCampaign` (audience résolue : inclus / exclus opt-out / injoignables +
  exemples de messages), `approveCampaign` (`marketing.manage` → READY),
  `sendCampaign` (`marketing.send`). Envoi : item par `(campaignId, customerId)`
  en `upsert` (retry = pas de doublon, §30) ; dans la fenêtre 24 h → `sendText`,
  hors fenêtre → `sendTemplate` si `templateName`, sinon item **SKIPPED**
  (`OUT_OF_WINDOW_NO_TEMPLATE`, §25, §69). `audience-rules.ts` (pur, testé) +
  `consent.ts` (pur, testé) : l'opt-out est appliqué **systématiquement** par
  `resolveAudience`, impossible à contourner.
- **JobQueue** (`server/jobs/`) : interface `JobQueue` + `InProcessJobQueue`
  (table `jobs`, verrouillage optimiste). `retry.ts` (pur, testé) : backoff
  `1 → 5 → 15 → 30 → 60 min` borné, `FAILED` (retry) puis `DEAD` (essais
  épuisés), `jobDedupeKey` pour un enqueue idempotent (§34, §35, §72).
- **Notifications** (`notification-service.ts`) : centre in-app, périmètre par
  rôle (`userId` ciblé ou `null` = organisation, visible des rôles larges).
- **Déclencheurs** : `POST /api/internal/automations/run` et
  `POST /api/internal/jobs/run` (header `x-automation-secret`) ; bouton
  « Analyser maintenant » sur `/automations` (`automations.manage`).
- **Audit** : `AUTOMATION_RULE_CREATED/UPDATED`, `AUTOMATION_RUN_COMPLETED`,
  `RECOMMENDATION_CREATED/DISMISSED`,
  `MARKETING_CAMPAIGN_CREATED/APPROVED/SENT`, `MARKETING_OPT_OUT`.
- Tests d'intégration DB : `tests/automations-marketing.integration.test.ts`
  (skip sans `RUN_DB_TESTS`) — §62–§72.

### Production, monétisation & pilote (Phase 8)

Détail dans `docs/PRODUCTION-AUDIT.md` (audit classé CRITICAL→LOW) et
`docs/PRODUCTION.md` (environnements, release, rollback, index).

- **Garde-fous prod** (`src/lib/env.ts`) : `productionGuardIssues()` bloque le
  démarrage si `APP_ENV=production` + provider `mock` sans `*_ALLOW_MOCK_IN_PROD=1`,
  ou `RATE_LIMIT_STORE=redis` sans `REDIS_URL`, ou `ALLOW_DEMO_SEED=1`. `check:env`
  le rapporte. `APP_ENV` est distinct du `NODE_ENV` de Next (toujours `production`
  dans un build).
- **Sessions** (`auth/session-policy.ts`, pur, testé) : `isSessionStillValid`
  rejette une session émise avant `passwordChangedAt` **ou** `sessionInvalidBefore`.
  `revokeAllSessions()` — « déconnecter tous les appareils » (profil) + console
  opérateur (appareil compromis).
- **Rate-limit** (`ratelimit/`) : `MemoryRateLimitStore` (pur, testé) +
  sélection `memory`|`redis`. Connexion limitée par IP (`LOGIN_RATE_LIMIT_PER_MIN`).
- **Queue / worker** : handlers `AI_PROCESS` / `VOICE_TRANSCRIBE` /
  `WHATSAPP_SEND` / `AUTOMATION_RUN` / `DAILY_SUMMARY` ; `scripts/worker.ts` +
  `server/maintenance/cleanup.ts` (réservations / brouillons / propositions
  expirés, essais échus → `PAST_DUE`).
- **Monétisation** (`server/billing/`) : `plans.ts` / `features.ts` / `limits.ts`
  **purs et testés**. `Plan` (STARTER / BUSINESS / PRO), `Subscription`
  (TRIAL→ACTIVE/PAST_DUE/CANCELLED/SUSPENDED, essai `TRIAL_DAYS`).
  `hasFeature(sub, feature)` central (§20). `checkUsageLimit()` / `recordUsage()`
  avant/après IA, Voice, marketing, resolve, WhatsApp — un refus **n'engage
  aucune dépense fournisseur** ; `UsageCounter` agrégé par
  `(org, métrique, période)`. Page `/billing` (offre, essai, jauges d'usage,
  features). Abstraction `BillingProvider` (`ManualBillingProvider`).
- **Console opérateur** `/admin` (route group isolée, `requireSuperAdminPage`,
  `isSuperAdminUser` pur + testé) : organisations, abonnement, usage, statut
  WhatsApp, incidents, analytics — **jamais** de conversation / note / message.
- **Support & feedback** : `SupportTicket` + `/support` ; bouton « Donner mon
  avis » global (`Feedback`, avec la page d'origine).
- **Données client** : export CSV/JSON (`server/org/data-export.ts`, OWNER) ;
  demande de suppression d'organisation + période de grâce 14 j + annulation
  (`server/org/deletion-service.ts`), jamais de suppression brutale.
- **Sécurité HTTP** : `next.config.mjs` `headers()` — CSP, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `nosniff`.
- **Observabilité** : `src/lib/logger.ts` (JSON, redaction — testé),
  `logError` structuré + hook `setExceptionSink`, `installErrorTracking`,
  `/api/health` enrichi, `/api/readiness`.
- **CI** : `.github/workflows/ci.yml` — Postgres service, `check:env`,
  `prisma generate`, `migrate deploy` + `migrate status`, `typecheck`, `npm test`
  (`RUN_DB_TESTS=1`), `build`.
- **Onboarding** : `getOnboardingProgress()` (barre de progression + activation
  §46 sur le dashboard). Flags `Organization.isPilot` / `isDemo`.
- Tests d'intégration DB : `tests/e2e-full.integration.test.ts` (§48) et
  `tests/e2e-tenant.integration.test.ts` (§49) — skip sans `RUN_DB_TESTS`.

### Migrations

- `0001_init` … `0011_automations_marketing`, `0012_production_billing`
  générées **hors-ligne** (`prisma migrate diff` sur un instantané du schéma de
  la phase précédente) faute de base dans l'environnement de build. **À valider
  sur une vraie base de staging** : `prisma migrate deploy` puis
  `prisma migrate status` (aucune migration inattendue) — c'est une étape de la
  CI (`.github/workflows/ci.yml`).
- `0005` / `0007` ajoutent des valeurs à l'enum `CustomerActivityType` via
  `ALTER TYPE … ADD VALUE` : nécessite PostgreSQL ≥ 12 (valeurs non réutilisées
  dans la même migration). `0006` (6 enums, 3 tables), `0007` (7 enums,
  5 tables + 2 colonnes `messages`), `0008` (2 enums, 1 table),
  `0009_language_core` (9 enums, 15 tables `language_*`),
  `0010_language_learning_loop` (3 enums, 3 tables + 3 colonnes
  `language_observations`), `0011_automations_marketing` (14 enums, 7 tables
  `automation_*` / `business_recommendations` / `marketing_*` / `notifications` /
  `jobs` + 3 colonnes `customers`) et `0012_production_billing` (8 enums, 6 tables
  `plans` / `subscriptions` / `usage_counters` / `support_tickets` / `feedback` /
  `organization_deletion_requests` + 2 colonnes `users` — `sessionInvalidBefore`,
  `isSuperAdmin` — et 2 colonnes `organizations` — `isPilot`, `isDemo`) sont
  **purement additifs** (aucun `DROP` / `RENAME` / `ALTER COLUMN`).

### Catalogue & stock

- **Filtre par état de stock + pagination** : l'état (`IN/LOW/OUT`) est calculé,
  pas stocké → quand ce filtre est actif, la page charge jusqu'à 500 produits
  correspondants, calcule les snapshots, filtre puis pagine en mémoire.
  Suffisant pour un catalogue MVP ; à repasser en agrégat SQL (vue ou colonne
  cache invalidée par trigger) au-delà de quelques milliers de produits.
- `getStockSummary` parcourt tous les produits non archivés (O(n)) — idem.
- Mouvement d'inventaire : lecture + écriture dans une transaction
  `Serializable`. Sous forte contention Postgres peut renvoyer une erreur de
  sérialisation (message générique côté UI) — ajouter un retry si besoin.
- Pas de suppression physique de produit via l'UI (archivage uniquement) même
  pour un produit sans mouvement.
- Photo produit = URL uniquement (pas d'upload / Supabase Storage).

### Divers

- `package.json#prisma` (clé `seed`) est déprécié → migrer vers `prisma.config.ts`
  avant Prisma 7.
- `engineType = "binary"` (sous-processus) choisi pour contourner un blocage des
  addons natifs `.node` dans l'environnement de build ; repasser à `library`
  (défaut, plus rapide) sur une machine standard.
- `middleware.ts` ne vérifie que la **présence** du cookie ; l'autorité reste
  les Server Components / Server Actions.
- Tests via le runner natif `node:test` (Vitest écarté : bug d'installation
  d'`esbuild` sur les chemins contenant un espace).
