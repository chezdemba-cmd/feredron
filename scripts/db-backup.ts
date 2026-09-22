/**
 * Script utilitaire de sauvegarde PostgreSQL (§28, Action 8).
 *
 * Utilise pg_dump si présent, ou fournit les commandes Docker / CLI prêtes à l'emploi.
 *
 * Exécution :
 *   npm run db:backup
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function getTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function runBackup() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("✗ DATABASE_URL manquant dans l'environnement.");
    process.exit(1);
  }

  const backupDir = join(process.cwd(), "backups");
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const filename = `feredron_${getTimestamp()}.dump`;
  const filepath = join(backupDir, filename);

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  FEREDRON — Sauvegarde de Base de Données PostgreSQL              ");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  let pgDumpAvailable = false;
  try {
    execSync("pg_dump --version", { stdio: "ignore" });
    pgDumpAvailable = true;
  } catch {
    pgDumpAvailable = false;
  }

  if (pgDumpAvailable) {
    console.log(`Exécution de pg_dump vers : ${filepath}...`);
    try {
      execSync(`pg_dump --format=custom --no-owner --dbname="${dbUrl}" --file="${filepath}"`, {
        stdio: "inherit",
      });
      console.log(`\n✓ Sauvegarde réussie : ${filepath}`);
    } catch (err) {
      console.error("\n✗ Échec lors de l'exécution de pg_dump :", err);
      process.exit(1);
    }
  } else {
    console.log("ℹ pg_dump local non détecté dans le PATH système.");
    console.log("Commandes recommandées selon votre environnement :\n");
    console.log("1. Via Docker Compose (recommandé en production / VM) :");
    console.log(`   docker compose -f compose.prod.yaml exec -T postgres pg_dump -U feredron -d feredron_prod -Fc > "${filepath}"\n`);
    console.log("2. Via conteneur Docker éphémère (sans installer Postgres localement) :");
    console.log(`   docker run --rm -v "${backupDir}:/backups" postgres:16-alpine pg_dump "${dbUrl}" -Fc -f "/backups/${filename}"\n`);
    console.log("3. Restauration de test (à blanc) :");
    console.log(`   pg_restore --clean --if-exists --no-owner --dbname="<RESTORE_DATABASE_URL>" "${filepath}"`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════");
}

runBackup();
