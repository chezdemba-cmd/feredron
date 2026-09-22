/**
 * Applique les migrations Prisma en production/preview Vercel, jamais en
 * local. Vercel positionne toujours `VERCEL=1` dans l'environnement de build
 * (production ET preview) — un `npm run build` local ne déclenche jamais
 * `prisma migrate deploy` par accident.
 *
 * Appelé depuis le script `build` (package.json), avant `next build`.
 */
import { execSync } from "node:child_process";

if (process.env.VERCEL === "1") {
  console.log("[build] VERCEL=1 détecté → npx prisma migrate deploy");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
} else {
  console.log("[build] Build hors Vercel → migrate deploy ignoré (npm run prisma:deploy en local si besoin).");
}
