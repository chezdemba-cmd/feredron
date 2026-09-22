import Link from "next/link";
import { pageOrgContext } from "@/server/page-context";
import { listAuditLogs } from "@/server/audit/log";
import { prisma } from "@/server/db/client";
import { can } from "@/server/rbac/permissions";
import { getStockSummary } from "@/server/stock/stock-service";
import { orderScopeWhere } from "@/server/crm/scope";
import {
  getOverdueDebtsSummary,
  getCashCollectedToday,
} from "@/server/finance/finance-service";
import { formatAmount } from "@/lib/format";
import { todayRange } from "@/lib/tz";
import { Card, PageHeader } from "@/components/ui";
import { getProactiveDigest } from "@/server/automations/proactive";
import { buildDailyDigest } from "@/server/automations/daily-digest";
import { getOnboardingProgress } from "@/server/onboarding/progress";
import { QuickActions } from "@/components/mobile/QuickActions";

export const metadata = { title: "Accueil — FEREDRON" };

export default async function DashboardPage() {
  const ctx = await pageOrgContext();
  const { user, organization, role } = ctx;
  const today = todayRange(organization.timezone);
  const showCommerce = can(role, "orders.read");
  const showDebts = can(role, "debts.read");

  const debtsScope = orderScopeWhere(role, user.id);
  const showRecos = can(role, "recommendations.read");

  // Tous ces blocs sont indépendants les uns des autres (aucun ne dépend du
  // résultat d'un autre) : on les lance en une seule vague au lieu de les
  // attendre en série, pour réduire le temps de chargement du tableau de bord.
  const [
    memberCount,
    pendingInvites,
    activity,
    stock,
    commerce,
    overdueDebts,
    cashToday,
    onboarding,
    proactive,
    digest,
  ] = await Promise.all([
    prisma.organizationMember.count({
      where: { organizationId: organization.id, status: "ACTIVE" },
    }),
    prisma.invitation.count({
      where: { organizationId: organization.id, status: "PENDING" },
    }),
    can(role, "audit.read")
      ? listAuditLogs(organization.id, 6)
      : Promise.resolve([]),
    can(role, "stock.read")
      ? getStockSummary(organization.id)
      : Promise.resolve(null),
    showCommerce
      ? Promise.all([
          prisma.order.aggregate({
            where: {
              organizationId: organization.id,
              status: "DELIVERED",
              deliveredAt: { gte: today.gte, lt: today.lt },
            },
            _sum: { totalAmount: true },
          }),
          prisma.order.count({
            where: {
              organizationId: organization.id,
              createdAt: { gte: today.gte, lt: today.lt },
            },
          }),
          prisma.customer.count({
            where: {
              organizationId: organization.id,
              createdAt: { gte: today.gte, lt: today.lt },
            },
          }),
        ])
      : Promise.resolve(null),
    showDebts
      ? getOverdueDebtsSummary(organization.id, { scopeWhere: debtsScope })
      : Promise.resolve(null),
    showDebts
      ? getCashCollectedToday(organization.id, organization.timezone)
      : Promise.resolve(null),
    getOnboardingProgress(organization.id),
    showRecos
      ? getProactiveDigest(organization.id, role, user.id)
      : Promise.resolve(null),
    showRecos && showCommerce
      ? buildDailyDigest(organization.id, {
          timezone: organization.timezone,
          currency: organization.currency,
        })
      : Promise.resolve(null),
  ]);

  const salesToday = commerce?.[0]._sum.totalAmount ?? 0;
  const ordersToday = commerce?.[1] ?? 0;
  const newCustomersToday = commerce?.[2] ?? 0;

  return (
    <>
      <PageHeader
        title={`Bonjour ${user.firstName}`}
        subtitle={`Voici comment faire avancer les ventes de ${organization.name} aujourd'hui.`}
      />

      <QuickActions role={role} />

      <Card
        style={{
          marginBottom: 18,
          padding: "24px",
          background: "linear-gradient(135deg, #03172d 0%, #073c2a 100%)",
          color: "white",
          border: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px" }}>
            <div style={{ color: "#8be5aa", fontSize: 12, fontWeight: 800, letterSpacing: "0.09em", marginBottom: 8 }}>
              BRIEFING COMMERCIAL FEREDRON
            </div>
            <h2 className="feredron-briefing-title" style={{ fontSize: 28, marginBottom: 8 }}>
              {proactive && proactive.total > 0
                ? `${proactive.total} action(s) peuvent faire avancer vos ventes`
                : "Votre activité est sous contrôle"}
            </h2>
            <p style={{ margin: 0, color: "#dbe8e0", maxWidth: 650 }}>
              {proactive && proactive.total > 0
                ? "Commencez par les priorités ci-dessous. FEREDRON prépare l'action, vous gardez toujours la validation finale."
                : "Demandez à FEREDRON quoi vendre, à qui et avec quelle action commerciale."}
            </p>
          </div>
          <Link
            href="/ai"
            className="dj-btn dj-btn--primary"
            style={{ alignSelf: "center", background: "#ffb800", color: "#03172d", borderColor: "#ffb800" }}
          >
            Parler à FEREDRON
          </Link>
        </div>

        {proactive?.items.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginTop: 20 }}>
            {proactive.items.slice(0, 3).map((item, index) => (
              <Link
                key={item.type}
                href={item.href}
                style={{
                  display: "block",
                  padding: "14px 16px",
                  borderRadius: 16,
                  background: "rgba(255,255,255,0.1)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.14)",
                }}
              >
                <div style={{ color: "#ffcf3d", fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
                  PRIORITÉ {index + 1}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: "#c9d9cf", marginTop: 4 }}>Ouvrir et agir →</div>
              </Link>
            ))}
          </div>
        ) : null}
      </Card>

      {stock ? (
        <>
          <h3 style={{ fontSize: 15, margin: "0 0 12px", color: "var(--text-2)" }}>
            Produits à vendre
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
              gap: 16,
              marginBottom: 28,
            }}
          >
            {(
              [
                ["Produits", String(stock.productCount), "au catalogue"],
                [
                  "Sous le seuil",
                  String(stock.lowStock + stock.outOfStock),
                  `${stock.outOfStock} en rupture`,
                ],
                [
                  "Valeur du stock",
                  formatAmount(stock.stockValue, organization.currency),
                  "au prix d'achat",
                ],
              ] as Array<[string, string, string]>
            ).map(([label, value, note]) => (
              <Card key={label} style={{ padding: "20px 22px" }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                    marginBottom: 12,
                  }}
                >
                  {label}
                </div>
                <div
                  className="tnum"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 30,
                    lineHeight: 1,
                  }}
                >
                  {value}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
                  {note}
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {showCommerce ? (
        <>
          <h3 style={{ fontSize: 15, margin: "0 0 12px", color: "var(--text-2)" }}>
            Résultats du jour
          </h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            Calculée sur le fuseau {organization.timezone}.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
              gap: 16,
              marginBottom: 28,
            }}
          >
            {(
              [
                [
                  "Ventes du jour",
                  formatAmount(salesToday, organization.currency),
                  "commandes livrées aujourd'hui",
                ],
                ["Commandes du jour", String(ordersToday), "créées aujourd'hui"],
                [
                  "Nouveaux clients",
                  String(newCustomersToday),
                  "créés aujourd'hui",
                ],
              ] as Array<[string, string, string]>
            ).map(([label, value, note]) => (
              <Card key={label} style={{ padding: "20px 22px" }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                    marginBottom: 12,
                  }}
                >
                  {label}
                </div>
                <div
                  className="tnum"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 30,
                    lineHeight: 1,
                  }}
                >
                  {value}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
                  {note}
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {showDebts && overdueDebts && cashToday ? (
        <>
          <h3 style={{ fontSize: 15, margin: "0 0 12px", color: "var(--text-2)" }}>
            Argent à encaisser
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            {(
              [
                [
                  "Créances en retard",
                  formatAmount(overdueDebts.amount, organization.currency),
                  `${overdueDebts.customerCount} client(s) · ${overdueDebts.orderCount} commande(s)`,
                ],
                [
                  "Encaissements du jour",
                  formatAmount(cashToday.amount, organization.currency),
                  `${cashToday.count} paiement(s) · fuseau ${organization.timezone}`,
                ],
              ] as Array<[string, string, string]>
            ).map(([label, value, note]) => (
              <Card key={label} style={{ padding: "20px 22px" }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                    marginBottom: 12,
                  }}
                >
                  {label}
                </div>
                <div
                  className="tnum"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 30,
                    lineHeight: 1,
                  }}
                >
                  {value}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
                  {note}
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {showRecos && proactive ? (
        <>
          <h3 style={{ fontSize: 15, margin: "0 0 12px", color: "var(--text-2)" }}>
            Toutes les opportunités
          </h3>
          <Card style={{ marginBottom: digest ? 12 : 28 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: proactive.items.length ? 10 : 0 }}>
              {proactive.headline}
            </div>
            {proactive.items.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {proactive.items.map((it) => (
                  <Link
                    key={it.type}
                    href="/recommendations"
                    className="dj-badge"
                    style={{ fontWeight: 600, color: "var(--text-2)" }}
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            ) : null}
            <div style={{ marginTop: 12 }}>
              <Link href="/recommendations" className="dj-btn dj-btn--outline" style={{ height: 32, fontSize: 13, padding: "0 14px" }}>
                Voir les recommandations
              </Link>
            </div>
          </Card>
          {digest ? (
            <Card style={{ marginBottom: 28, background: "var(--card-alt)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 8 }}>
                Résumé du jour · {digest.day}
              </div>
              <div className="tnum" style={{ fontSize: 13, lineHeight: 1.7 }}>
                {formatAmount(digest.salesToday, organization.currency)} vendus ·{" "}
                {formatAmount(digest.cashCollectedToday, organization.currency)} encaissés ·{" "}
                {digest.ordersCreatedToday} commande(s) ·{" "}
                {digest.newCustomersToday} nouveau(x) client(s)
                {digest.overdueDebtCustomers > 0
                  ? ` · ${digest.overdueDebtCustomers} créance(s) à relancer`
                  : ""}
                {digest.outOfStockCount > 0 ? ` · ${digest.outOfStockCount} rupture(s)` : ""}
                {digest.lowStockCount > 0 ? ` · ${digest.lowStockCount} stock(s) faible(s)` : ""}
                {digest.ordersToPrepare > 0 ? ` · ${digest.ordersToPrepare} à préparer` : ""}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <Card>
          <h3 style={{ fontSize: 23, margin: "0 0 8px" }}>
            {onboarding.activated ? "Installation terminée" : "Terminez votre installation"}
          </h3>
          <p style={{ margin: "0 0 16px", color: "var(--text-2)", fontSize: 14 }}>
            {onboarding.doneCount}/{onboarding.total} étapes ·{" "}
            {onboarding.activated
              ? "votre organisation est activée."
              : "quelques étapes pour tirer parti de FEREDRON."}
          </p>
          <div style={{ height: 6, borderRadius: 999, background: "var(--border-soft)", marginBottom: 16 }}>
            <div
              style={{
                width: `${Math.round((onboarding.doneCount / onboarding.total) * 100)}%`,
                height: "100%",
                borderRadius: 999,
                background: "var(--green)",
              }}
            />
          </div>
          {onboarding.steps.map((s) => (
            <ChecklistItem
              key={s.key}
              done={s.done}
              label={s.label}
              detail={s.done ? "Fait" : "À faire"}
              action={
                !s.done ? (
                  <Link href={s.href} className="dj-btn dj-btn--outline" style={{ height: 34, fontSize: 13, padding: "0 16px" }}>
                    Ouvrir
                  </Link>
                ) : undefined
              }
            />
          ))}
        </Card>

        <Card>
          <h4 style={{ fontSize: 19, margin: "0 0 14px" }}>Journal d&apos;activité</h4>
          {activity.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
              {can(role, "audit.read")
                ? "Aucune activité récente."
                : "Réservé aux rôles Administrateur, Gérant et Propriétaire."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {activity.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 12 }}>
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: "var(--accent)",
                      marginTop: 7,
                      flex: "none",
                    }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {humanizeAction(a.action)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                      {a.actor
                        ? `${a.actor.firstName} ${a.actor.lastName}`
                        : "Système"}{" "}
                      · {a.createdAt.toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function ChecklistItem({
  done,
  label,
  detail,
  action,
}: {
  done: boolean;
  label: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 4px",
        borderBottom: "1px solid var(--border-soft)",
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: done ? "var(--green)" : "transparent",
          border: done ? "0" : "2px solid var(--border)",
          color: "var(--ok-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          flex: "none",
        }}
      >
        {done ? "✓" : ""}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>{detail}</div>
      </div>
      {action}
    </div>
  );
}

function humanizeAction(action: string): string {
  const map: Record<string, string> = {
    ORGANIZATION_CREATED: "Entreprise créée",
    ORGANIZATION_UPDATED: "Entreprise mise à jour",
    SETTINGS_UPDATED: "Paramètres modifiés",
    MEMBER_INVITED: "Invitation envoyée",
    MEMBER_INVITE_REVOKED: "Invitation révoquée",
    MEMBER_JOINED: "Nouveau membre",
    MEMBER_ROLE_CHANGED: "Rôle d'un membre modifié",
    MEMBER_REMOVED: "Membre retiré",
    MEMBER_SUSPENDED: "Membre suspendu",
    MEMBER_REACTIVATED: "Membre réactivé",
    USER_REGISTERED: "Compte créé",
    LOGIN_SUCCESS: "Connexion",
    PROFILE_UPDATED: "Profil mis à jour",
    PASSWORD_CHANGED: "Mot de passe changé",
  };
  return map[action] ?? action;
}
