import "server-only";
import type {
  Prisma,
  PrismaClient,
  ReservationSourceType,
  StockReservation,
} from "@prisma/client";
import { prisma } from "@/server/db/client";
import { Conflict, NotFound } from "@/server/errors";
import { getPhysicalStock, getReservedStock } from "./stock-service";
import { availableStock } from "./movement-rules";

/**
 * Primitives de RÉSERVATION de stock — prêtes pour la Phase 3 (commandes).
 * Aucune création manuelle via l'UI en Phase 2.
 *
 * Concurrence : les créations concurrentes doivent s'exécuter dans une
 * transaction `Serializable` (voir `reserveStockTx`) pour que le contrôle
 * « quantité ≤ disponible » ne soit pas contourné par une lecture obsolète.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type ReserveInput = {
  organizationId: string;
  productId: string;
  quantity: number;
  sourceType?: ReservationSourceType;
  sourceId?: string | null;
  expiresAt?: Date | null;
  /** Autorise le dépassement du disponible (permission exceptionnelle). */
  allowOverbook?: boolean;
};

/**
 * Le paramètre `db` est volontairement typé `Prisma.TransactionClient` (et non
 * `Db` / `PrismaClient`) : impossible à l'appel de passer le client global
 * `prisma` par erreur et de recréer la course « lire disponible → écrire »
 * hors transaction. Tout appelant doit ouvrir sa propre transaction
 * (`Serializable` recommandé) ou utiliser `reserveStockTx`.
 */
export async function reserveStock(
  input: ReserveInput,
  db: Prisma.TransactionClient,
): Promise<StockReservation> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw Conflict("La quantité réservée doit être un entier positif.");
  }

  const product = await db.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
    select: { id: true, status: true },
  });
  if (!product) throw NotFound("Produit introuvable dans cette entreprise.");
  if (product.status === "ARCHIVED") {
    throw Conflict("Impossible de réserver un produit archivé.");
  }

  if (!input.allowOverbook) {
    const [physical, reserved] = await Promise.all([
      getPhysicalStock(input.organizationId, input.productId, db),
      getReservedStock(input.organizationId, input.productId, db),
    ]);
    if (input.quantity > availableStock(physical, reserved)) {
      throw Conflict(
        "Quantité demandée supérieure au stock disponible.",
      );
    }
  }

  return db.stockReservation.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      quantity: input.quantity,
      status: "ACTIVE",
      sourceType: input.sourceType ?? "ORDER",
      sourceId: input.sourceId ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

/** Variante transactionnelle recommandée pour les créations concurrentes. */
export async function reserveStockTx(
  input: ReserveInput,
): Promise<StockReservation> {
  return prisma.$transaction((tx) => reserveStock(input, tx), {
    isolationLevel: "Serializable",
  });
}

export async function releaseReservation(
  organizationId: string,
  reservationId: string,
  db: Db = prisma,
): Promise<StockReservation> {
  const reservation = await db.stockReservation.findFirst({
    where: { id: reservationId, organizationId },
  });
  if (!reservation) throw NotFound("Réservation introuvable.");
  if (reservation.status !== "ACTIVE") return reservation;
  return db.stockReservation.update({
    where: { id: reservation.id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
}

/**
 * Solde une réservation ACTIVE : passe FULFILLED et génère le mouvement SALE
 * correspondant (chemin « commande livrée » de la Phase 3).
 */
export async function fulfillReservation(
  organizationId: string,
  reservationId: string,
  opts: { actorUserId?: string | null; reference?: string | null },
  db: Db = prisma,
): Promise<StockReservation> {
  const reservation = await db.stockReservation.findFirst({
    where: { id: reservationId, organizationId },
  });
  if (!reservation) throw NotFound("Réservation introuvable.");
  if (reservation.status !== "ACTIVE") {
    throw Conflict("Cette réservation n'est plus active.");
  }

  await db.stockMovement.create({
    data: {
      organizationId,
      productId: reservation.productId,
      type: "SALE",
      quantity: reservation.quantity,
      reference: opts.reference ?? reservation.sourceId ?? null,
      actorUserId: opts.actorUserId ?? null,
      metadata: { reservationId: reservation.id },
    },
  });

  return db.stockReservation.update({
    where: { id: reservation.id },
    data: { status: "FULFILLED", fulfilledAt: new Date() },
  });
}

/** Passe les réservations ACTIVE expirées en EXPIRED (tâche périodique future). */
export async function expireStaleReservations(
  organizationId: string,
  db: Db = prisma,
): Promise<number> {
  const res = await db.stockReservation.updateMany({
    where: {
      organizationId,
      status: "ACTIVE",
      expiresAt: { not: null, lt: new Date() },
    },
    data: { status: "EXPIRED", releasedAt: new Date() },
  });
  return res.count;
}
