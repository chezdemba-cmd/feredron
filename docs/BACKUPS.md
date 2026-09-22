# Sauvegardes & restauration (§28)

> Une sauvegarde non restaurable ne compte pas.

## Politique

- **Fréquence** : sauvegarde complète quotidienne de la base PostgreSQL +
  journalisation WAL / PITR si le fournisseur le propose.
- **Rétention** : 7 sauvegardes quotidiennes + 4 hebdomadaires + 3 mensuelles.
- **Chiffrement** : au repos (fournisseur) ; accès restreint.
- **Emplacement** : région distincte de la base primaire si possible.

## Sauvegarde automatisée

`.github/workflows/backup.yml` exécute `npm run db:backup` chaque jour à
03:00 UTC (workflow_dispatch disponible pour un déclenchement manuel depuis
GitHub Actions) et archive le dump comme artefact GitHub Actions (rétention
35 jours — couvre la politique "7 quotidiennes" ci-dessus avec de la marge ;
les paliers hebdo/mensuel restent à couvrir par les snapshots natifs du
fournisseur Postgres managé, voir note ci-dessous).

**Action ponctuelle requise** : ajouter le secret de dépôt
`PROD_DATABASE_URL` (Settings → Secrets and variables → Actions du repo
GitHub) avec l'URL de connexion à la base de production réelle. Sans ce
secret, le workflow échoue explicitement (pas d'échec silencieux).

Si le fournisseur Postgres managé (Supabase/Neon) propose déjà des
sauvegardes/PITR automatiques natives, les considérer comme la ligne de
défense principale — ce workflow est une seconde copie indépendante, utile
en cas de problème côté fournisseur ou pour un export portable.

### Sauvegarde manuelle (ad hoc)

Commande directe via le script utilitaire :
```bash
npm run db:backup
```

Ou via Docker Compose (environnement VM / conteneur) :
```bash
docker compose -f compose.prod.yaml exec -T postgres pg_dump -U feredron -d feredron_prod -Fc > "backups/feredron-$(date +%F).dump"
```

## Test de restauration (à blanc — mensuel ou pré-production)

1. Provisionner une base vide `feredron_restore` (locale ou conteneur de test).
2. Restaurer le fichier dump :
   ```bash
   pg_restore --clean --if-exists --no-owner --dbname "$RESTORE_URL" backups/feredron-YYYY-MM-DD.dump
   ```
3. Valider l'état du schéma :
   ```bash
   DATABASE_URL=$RESTORE_URL npx prisma migrate status
   ```
   *(Doit afficher `Database schema is up to date!`)*
4. Lancer l'app contre la base restaurée et valider la sonde :
   `GET /api/readiness` → `200 OK` (`checks.database: true`, `checks.migrations: true`).
5. Contrôles de cohérence : quelques commandes (total = somme des lignes),
   `amountPaid` = Σ paiements CONFIRMED, comptes d'organisations.
6. Consigner la date et le résultat du test.

## Ce qui n'est PAS dans la base

- Fichiers audio WhatsApp : **non conservés** (téléchargés, transcrits, jetés).
- Secrets : dans le gestionnaire de secrets de la plateforme, pas dans la base.
