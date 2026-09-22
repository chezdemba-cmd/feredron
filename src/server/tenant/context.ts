import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type {
  Organization,
  OrganizationMember,
  Role,
  User,
} from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getEnv } from "@/lib/env";
import { Forbidden, OrganizationUnavailable } from "@/server/errors";
import { evaluateOrganizationAccess } from "./access-policy";

const ACTIVE_ORG_COOKIE = "dj_org";

export type OrgContext = {
  user: User;
  organization: Organization;
  membership: OrganizationMember;
  role: Role;
};

/**
 * Barrière multi-tenant. Vérifie côté serveur que `userId` est membre actif
 * de `organizationId`. AUCUN accès aux données d'une organisation ne doit se
 * faire sans être passé par ici — on ne fait jamais confiance à un
 * organizationId fourni par le client.
 */
export async function requireOrganizationAccess(
  userId: string,
  organizationId: string,
): Promise<OrgContext> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: true, user: true },
  });

  const decision = evaluateOrganizationAccess(membership);
  if (!decision.ok || !membership) {
    if (decision.ok === false && decision.reason === "ORG_INACTIVE") {
      throw OrganizationUnavailable();
    }
    throw Forbidden("Vous n'êtes pas membre de cette entreprise.");
  }

  return {
    user: membership.user,
    organization: membership.organization,
    membership,
    role: membership.role,
  };
}

export function listMemberships(userId: string) {
  return prisma.organizationMember.findMany({
    where: { userId, status: { not: "SUSPENDED" } },
    include: { organization: true },
    orderBy: { joinedAt: "asc" },
  });
}

export async function setActiveOrganization(organizationId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().APP_ENV !== "development",
    path: "/",
  });
}

export async function readActiveOrganizationId(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_ORG_COOKIE)?.value ?? null;
}

/**
 * Résout l'organisation active de l'utilisateur (cookie sinon 1ʳᵉ appartenance)
 * puis re-valide l'accès côté serveur. Renvoie null si l'utilisateur n'a
 * aucune organisation (→ onboarding).
 */
export const getOrgContext = cache(
  async (user: User): Promise<OrgContext | null> => {
    const memberships = await listMemberships(user.id);
    if (memberships.length === 0) return null;

    const preferred = await readActiveOrganizationId();
    const chosen =
      memberships.find((m) => m.organizationId === preferred) ?? memberships[0];
    if (!chosen) return null;

    // `chosen` porte déjà `organization` (via `listMemberships`) : on évalue
    // l'accès sur ces données au lieu de refaire un `findUnique` identique.
    const decision = evaluateOrganizationAccess(chosen);
    if (!decision.ok) {
      if (decision.reason === "ORG_INACTIVE") throw OrganizationUnavailable();
      throw Forbidden("Vous n'êtes pas membre de cette entreprise.");
    }

    return { user, organization: chosen.organization, membership: chosen, role: chosen.role };
  },
);

/** Variante « page » : redirige vers /onboarding si aucune organisation. */
export async function requireOrgContext(user: User): Promise<OrgContext> {
  const ctx = await getOrgContext(user);
  if (!ctx) redirect("/onboarding");
  return ctx;
}
