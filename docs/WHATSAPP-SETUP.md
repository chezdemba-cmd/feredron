# Checklist configuration WhatsApp Business (§11)

Plateforme : **WhatsApp Business Platform — Cloud API** (officielle, jamais de
solution non officielle / scraping).

## Côté Meta (plateforme Djeli, une seule fois)

- [ ] **App Meta** créée (type *Business*), `META_APP_ID` / `META_APP_SECRET` renseignés.
- [ ] Produit **WhatsApp** ajouté à l'app.
- [ ] **Webhook** configuré :
  - URL publique **HTTPS** : `https://<domaine>/api/webhooks/whatsapp`
  - **Verify token** = `META_WEBHOOK_VERIFY_TOKEN` (secret)
  - Champs abonnés : `messages` (au minimum)
- [ ] Signature `X-Hub-Signature-256` vérifiée par l'app (`META_APP_SECRET`) — déjà implémenté.
- [ ] **Version Graph API** fixée : `META_GRAPH_API_VERSION` (ex : `v23.0`),
  jamais concaténée à la main ailleurs.
- [ ] Statut de l'app : passer en **Live** (mode dev = numéros de test seulement).

## Côté organisation cliente (dans Djeli → Paramètres → WhatsApp)

- [ ] **WABA ID** (WhatsApp Business Account).
- [ ] **Phone Number ID** — c'est LUI qui détermine le tenant d'un webhook
  entrant, **jamais** le numéro du client.
- [ ] **Access token** (long-lived / system user) — stocké **chiffré** en base
  (`WHATSAPP_TOKEN_ENCRYPTION_KEY`), jamais exposé au frontend / logs / audit.
- [ ] **Permissions** du token : `whatsapp_business_messaging`, `whatsapp_business_management`.
- [ ] Numéro **vérifié** et **enregistré** (name approval si affichage du nom).
- [ ] **Templates** approuvés pour toute communication **hors fenêtre 24 h**
  (campagnes marketing, relances). Sans template compatible → l'envoi est
  **bloqué** (jamais de texte libre hors fenêtre).

## Production

- [ ] `WHATSAPP_PROVIDER=meta` (le garde-fou refuse `mock` en `APP_ENV=production`).
- [ ] Quotas de messagerie Meta (tiers) suffisants pour le volume pilote.
- [ ] Surveillance : `WHATSAPP_DISCONNECTED` dans l'audit, `lastError` sur la connexion,
  `/admin/<org>` (statut de connexion, dernière erreur).
