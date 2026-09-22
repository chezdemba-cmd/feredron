# Déploiement & exploitation

## Environnements (§52)

| Env | `APP_ENV` | Base | Providers | Seed |
|---|---|---|---|---|
| Développement | `development` | Postgres local | `mock` | `npm run db:seed` |
| Staging | `staging` | Postgres dédié (données non prod) | sandbox / mock autorisé | seed staging dédié |
| Production | `production` | Postgres managé + sauvegardes | **réels obligatoires** | **jamais** |

Secrets **séparés par environnement** (aucun secret partagé prod ↔ staging).
`APP_ENV` est indépendant du `NODE_ENV` de Next (qui vaut toujours `production`
dans un build). Les garde-fous (`productionGuardIssues`) ne s'appliquent que si
`APP_ENV=production`.

## Déploiement réel : Vercel

**La production réelle de FEREDRON tourne sur Vercel** (projet `feredron`,
`.vercel/project.json`), pas sur Docker Compose. C'est un déploiement
serverless : pas de process de fond persistant.

- **web** : build Next.js standard, déployé par Vercel à chaque push.
- **migrations** : `npm run build` = `prisma generate && node
  scripts/vercel-migrate.mjs && next build`. Le script exécute
  `prisma migrate deploy` automatiquement dès que `VERCEL=1` (positionné par
  Vercel sur tout build, production ET preview) — **jamais** en local
  (`npm run build` sur un poste dev n'y touche pas). Cible toujours le
  `DATABASE_URL` de l'environnement Vercel courant.
- **jobs planifiés** (relances, expiration des réservations, file de jobs) :
  `vercel.json` déclare 3 Vercel Cron Jobs (GET) vers `/api/internal/{jobs,
  automations,maintenance}/run`, authentifiés par l'en-tête `Authorization:
  Bearer <CRON_SECRET>` que Vercel envoie automatiquement. **Action requise
  une fois** : poser la variable de projet Vercel `CRON_SECRET` avec la MÊME
  valeur que `AUTOMATION_CRON_SECRET` (Settings → Environment Variables).
  Sans cette variable, les 3 routes renvoient 401 et rien ne s'exécute.
  ⚠️ Sur le plan Vercel **Hobby**, un cron ne peut tourner qu'**une fois par
  jour** (horaire imprécis, dans l'heure indiquée) — les horaires de
  `vercel.json` sont choisis pour être valides sur Hobby ; resserrer la
  fréquence nécessite un plan payant.
- **sauvegardes** : `.github/workflows/backup.yml` (cron quotidien 03:00 UTC)
  exécute `npm run db:backup` et archive le dump comme artefact GitHub Actions
  (35 jours). **Action requise une fois** : ajouter le secret de dépôt
  `PROD_DATABASE_URL` (Settings → Secrets and variables → Actions). Voir
  `docs/BACKUPS.md`.
- **topologie & rate-limit** : `DEPLOYMENT_TOPOLOGY=single` avec
  `RATE_LIMIT_STORE=memory` — accepté pour le pilote, mais Vercel est
  intrinsèquement multi-instance : le rate-limit par IP en mémoire n'est donc
  pas garanti global (le verrouillage de compte, lui, est en base et reste
  fiable). `RATE_LIMIT_STORE=redis` n'est pas encore implémenté.

### Voie alternative : auto-hébergement Docker (non utilisée actuellement)

`Dockerfile` + `compose.prod.yaml` restent disponibles pour un futur
déploiement auto-hébergé (VM/K8s) avec un vrai worker persistant
(`npm run worker`) au lieu des Vercel Cron Jobs :
```bash
docker compose -f compose.prod.yaml up -d --build
```
Ceci n'est **pas** le chemin de déploiement réel aujourd'hui — ne pas s'y
fier pour diagnostiquer un incident de production.

## Procédure de release (§55)

1. `npm ci`
2. `npm run check:env` (valide la config + garde-fous prod)
3. `git push` sur la branche suivie par Vercel — le build Vercel exécute
   automatiquement `prisma generate`, `prisma migrate deploy` (§ ci-dessus)
   puis `next build`.
4. `npx prisma migrate status` (en local, contre la base de prod) → doit être
   *up to date*, **aucune** migration inattendue / destructive, en
   vérification post-déploiement.
5. Smoke : `GET /api/readiness` → `200`, `GET /api/health` → `200`,
   connexion + création d'une commande de test sur un compte interne
6. Surveiller les logs `level:error` (Vercel → Logs, ou Sentry) pendant 15 min

## Rollback (§56)

- **Code** : `vercel rollback` (ou Instant Rollback depuis le dashboard) vers
  le déploiement précédent.
- **Migrations** : toutes les migrations à ce jour sont **purement additives**
  (aucun `DROP` / `RENAME` / `ALTER COLUMN` destructif — vérifié sur
  l'ensemble de `prisma/migrations/`). Un rollback de code fonctionne donc
  sans rollback de schéma. Ne **jamais** rollback automatiquement une
  migration destructive future : restauration depuis sauvegarde + correctif
  manuel.
- Vercel **n'annule pas** les migrations déjà appliquées lors d'un rollback de
  code (elles sont additives, donc sans danger pour l'ancienne version) ; les
  Vercel Cron Jobs actifs continuent de tourner tels quels après un rollback.
- Vérifier `prisma migrate status` après rollback.

## <a id="index"></a>Revue d'index (§37)

Requêtes chaudes et index associés (déjà en place) :

| Requête | Index |
|---|---|
| Liste clients / scope SALES | `customers(organizationId, status)`, `(organizationId, assignedToUserId)` |
| Catalogue / recherche | `products(organizationId, status)`, `(organizationId, barcode)` |
| Commandes par statut / échéance | `orders(organizationId, status)`, `(organizationId, dueDate)`, `(organizationId, createdAt)` |
| Messages d'une conversation | `messages(conversationId, createdAt)`, idempotence `(organizationId, externalMessageId)` |
| Paiements / encaissements du jour | `payments(organizationId, status)`, `(organizationId, paidAt)` |
| Créances | dérivées d'`orders` filtrées (`status=DELIVERED`, `paymentStatus≠PAID`) |
| Recommandations | `business_recommendations(organizationId, status, priority)`, dédup `(organizationId, dedupeKey)` |
| Usage metering | `usage_counters(organizationId, metric, period, periodKey)` unique |
| Language resolve | `language_entries` par scope + `language_variants(normalizedForm)` |

Pagination : toutes les listes principales sont bornées (`take`) et paginées.
Agrégats stock/finance : une requête `groupBy` par dimension (pas de N+1).

## Sécurité (§33, §34, §35, §36)

- En-têtes : CSP, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, `X-Content-Type-Options: nosniff` (`next.config.mjs`).
- CSRF : Server Actions Next = vérification d'origine intégrée ; routes internes
  = secret partagé `AUTOMATION_CRON_SECRET`.
- Jetons WhatsApp chiffrés au repos (`WHATSAPP_TOKEN_ENCRYPTION_KEY`, AES-256-GCM).
- Rotation des secrets : `docs/SECRETS-ROTATION.md`.

## Observabilité (§24, §25, §26, §27)

- Logs JSON structurés (`src/lib/logger.ts`) : `ts`, `level`, `msg`, `service`,
  `event`, `requestId?`, `organizationId?` — **jamais** de PII ni de secret.
- `installErrorTracking()` : branche Sentry si `SENTRY_DSN` (ajouter `@sentry/node`).
- `/api/health` : DB + latence + jobs bloqués + providers + store rate-limit.
- `/api/readiness` : config valide + DB + migrations appliquées.
