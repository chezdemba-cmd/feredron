import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma. Attaché à `globalThis` DANS TOUS LES ENVIRONNEMENTS :
 *  - dev : évite d'ouvrir un pool par hot-reload ;
 *  - prod serverless : si le module est ré-évalué dans une instance chaude,
 *    on réutilise le même client au lieu d'en créer un nouveau (chaque client
 *    ouvre son propre pool → épuisement des connexions du pooler Supabase).
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

globalForPrisma.prisma = prisma;
