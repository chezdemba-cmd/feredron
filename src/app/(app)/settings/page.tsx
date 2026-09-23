import { pageOrgContext } from "@/server/page-context";
import { can } from "@/server/rbac/permissions";
import { getConnectionForOrg } from "@/server/whatsapp/connection-service";
import { Card, PageHeader } from "@/components/ui";
import { ForbiddenPanel } from "@/components/ForbiddenPanel";
import { SettingsForm, type OrgSettings } from "@/components/settings/SettingsForm";
import { OrgDataControls } from "@/components/settings/OrgDataControls";
import { getDeletionRequest } from "@/server/org/deletion-service";
import {
  WhatsAppConnectionForm,
  type WhatsAppConnectionView,
} from "@/components/whatsapp/WhatsAppConnectionForm";

export const metadata = { title: "Paramètres — FEREDRON" };

export default async function SettingsPage() {
  const ctx = await pageOrgContext();
  const { organization, role } = ctx;

  if (!can(role, "settings.read")) {
    return <ForbiddenPanel role={role} requiredFor="les paramètres de l'entreprise" />;
  }

  const org: OrgSettings = {
    id: organization.id,
    name: organization.name,
    phone: organization.phone ?? "",
    email: organization.email ?? "",
    countryCode: organization.countryCode,
    currency: organization.currency,
    timezone: organization.timezone,
    addressLine: organization.addressLine ?? "",
    city: organization.city ?? "",
    district: organization.district ?? "",
    businessType: organization.businessType,
  };

  const rawConn = await getConnectionForOrg(organization.id);
  const connectionView: WhatsAppConnectionView | null = rawConn
    ? {
        status: rawConn.status,
        provider: rawConn.provider,
        phoneNumberId: rawConn.phoneNumberId,
        displayPhoneNumber: rawConn.displayPhoneNumber,
        verifiedName: rawConn.verifiedName,
        businessAccountId: rawConn.businessAccountId,
        connectedAt: rawConn.connectedAt ? rawConn.connectedAt.toISOString() : null,
        lastEventAt: rawConn.lastEventAt ? rawConn.lastEventAt.toISOString() : null,
        lastError: rawConn.lastError,
        hasToken: rawConn.hasToken,
      }
    : null;
  const mockProvider = (process.env.WHATSAPP_PROVIDER ?? "mock") === "mock";
  const embeddedSignup =
    process.env.META_APP_ID && process.env.META_EMBEDDED_SIGNUP_CONFIG_ID
      ? {
          appId: process.env.META_APP_ID,
          configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
          graphVersion: process.env.META_GRAPH_API_VERSION ?? "v23.0",
        }
      : null;
  const deletionRequest = await getDeletionRequest(organization.id);

  return (
    <>
      <PageHeader
        title="Paramètres de l'entreprise"
        subtitle="Ces réglages s'appliquent à toute l'organisation."
      />
      <Card style={{ maxWidth: 760 }}>
        <SettingsForm org={org} canEdit={can(role, "settings.update")} />
      </Card>

      <Card style={{ maxWidth: 760, marginTop: 20 }}>
        <h3 style={{ fontSize: 19, margin: "0 0 6px" }}>WhatsApp Business</h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-2)" }}>
          Connectez le numéro WhatsApp Business Cloud API de l&apos;entreprise pour
          recevoir et répondre aux messages depuis FEREDRON.
        </p>
        <WhatsAppConnectionForm
          organizationId={organization.id}
          connection={connectionView}
          canEdit={can(role, "settings.update")}
          mockProvider={mockProvider}
          embeddedSignup={embeddedSignup}
        />
      </Card>

      <Card style={{ maxWidth: 760, marginTop: 20 }}>
        <h3 style={{ fontSize: 19, margin: "0 0 6px" }}>Données de l&apos;entreprise</h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-2)" }}>
          Exportez vos données à tout moment. La suppression passe par une
          période de grâce.
        </p>
        <OrgDataControls
          canDelete={can(role, "organization.delete")}
          deletion={
            deletionRequest
              ? { status: deletionRequest.status, purgeAfter: deletionRequest.purgeAfter.toISOString() }
              : null
          }
        />
      </Card>
    </>
  );
}
