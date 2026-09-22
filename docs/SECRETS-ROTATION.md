# Rotation des secrets (§35, §36)

Tous les secrets vivent dans le gestionnaire de secrets de la plateforme
d'hébergement, **jamais** dans le dépôt ni dans la base.

| Secret | Effet d'une rotation | Procédure |
|---|---|---|
| `AUTH_SESSION_SECRET` | Invalide **toutes** les sessions (JWT non vérifiables) | Changer la valeur → redéployer. Communiquer aux utilisateurs (reconnexion). |
| `META_APP_SECRET` | Vérification de signature webhook + échanges token | Roter côté Meta, mettre à jour la variable, redéployer, envoyer un message test. |
| `META_WEBHOOK_VERIFY_TOKEN` | Re-vérification du webhook | Changer la valeur **puis** re-valider l'URL côté Meta. |
| Access tokens WhatsApp (par organisation, chiffrés en base) | Reconnexion du numéro | Générer un nouveau token (system user), le re-saisir dans Paramètres → WhatsApp. |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | Les tokens chiffrés existants deviennent illisibles | **Fenêtre de maintenance** : soit re-saisir toutes les connexions WhatsApp, soit script de re-chiffrement (déchiffre avec l'ancienne clé, rechiffre avec la nouvelle). Prévoir un préfixe d'ID de clé si rotation régulière. |
| `AI_API_KEY` / `VOICE_API_KEY` / `EMAIL_API_KEY` | Coupe l'accès au provider (IA / transcription / e-mail transactionnel) | Roter chez le provider, mettre à jour, redéployer. Aucun impact données. |
| `LANGUAGE_DEMO_CLIENT_SECRET` | Le client API de démo ne s'authentifie plus | Régénérer côté `LanguageApplicationClient` (secret **haché** en base). |
| `AUTOMATION_CRON_SECRET` | Le worker / cron ne peut plus déclencher les routes internes | Changer la valeur **et** la configuration du worker/cron simultanément. |
| `DATABASE_URL` (mot de passe) | Coupe la connexion DB | Roter le rôle Postgres, mettre à jour **DATABASE_URL et DIRECT_URL** (même identifiants, ports différents), redéployer web **et** worker. |
| `DIRECT_URL` | Coupe `prisma migrate deploy` (pas l'app — elle n'utilise que `DATABASE_URL`) | Même rotation que `DATABASE_URL` : identifiants identiques, port 5432 (direct/session) au lieu de 6543 (pooler transaction), sans `pgbouncer=true`. |

## Cadence recommandée

- Secrets d'infra (`AUTH_SESSION_SECRET`, DB, `AUTOMATION_CRON_SECRET`) : tous les 6–12 mois ou sur incident.
- Clés de provider : selon la politique du provider ou sur incident.
- Sur suspicion de compromission : rotation immédiate + `revokeAllSessions` pour les comptes concernés (console `/admin`).

## Génération de nouveaux secrets conformes

Pour générer des secrets cryptographiques de haute entropie conformes aux spécifications (longueurs, encodages base64url/hex et 32 octets AES-256-GCM) :

```bash
npm run gen:secrets
```

