import { z } from "zod";
import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
} from "@/server/tenant/ownership-rules";
import { isValidPhone } from "@/lib/identifiers";
import { passwordIssue, MAX_PASSWORD_LENGTH } from "@/server/auth/password-policy";

/** Enums métier alignés sur Prisma (dupliqués ici pour valider les entrées client). */
export const roleEnum = z.enum(["OWNER", "ADMIN", "MANAGER", "SALES", "EMPLOYEE"]);
export const businessTypeEnum = z.enum([
  "WHOLESALE",
  "RETAIL",
  "DISTRIBUTION",
  "IMPORT_EXPORT",
  "OTHER",
]);

const nameField = z.string().trim().min(2, "Au moins 2 caractères").max(80);
const emailField = z.string().trim().toLowerCase().email("Email invalide");
const phoneField = z
  .string()
  .trim()
  .min(6, "Numéro trop court")
  .max(24, "Numéro trop long");
const passwordField = z
  .string()
  .max(MAX_PASSWORD_LENGTH, "Mot de passe trop long")
  .superRefine((v, ctx) => {
    const issue = passwordIssue(v);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
  });

// ── Auth ──────────────────────────────────────────────────────────────

export const registerSchema = z
  .object({
    firstName: nameField,
    lastName: nameField,
    email: emailField,
    phone: phoneField.optional().or(z.literal("").transform(() => undefined)),
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas",
  })
  .superRefine((v, ctx) => {
    if (v.phone && !isValidPhone(v.phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message:
          "Numéro invalide. Saisissez un numéro local ou au format international (+33…, +225…).",
      });
    }
  });

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Mot de passe requis"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis"),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas",
  });

export const requestPasswordResetSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(10, "Lien invalide"),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas",
  });

export const updateProfileSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  locale: z.enum(["fr", "en"]).default("fr"),
});

// ── Organisation / onboarding ─────────────────────────────────────────

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Au moins 2 caractères").max(120),
  countryCode: z.string().trim().length(2).toUpperCase().default("ML"),
  currency: z.string().trim().length(3).toUpperCase().default("XOF"),
  timezone: z.string().trim().min(1).default("Africa/Bamako"),
  city: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
  businessType: businessTypeEnum.default("WHOLESALE"),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneField.optional().or(z.literal("").transform(() => undefined)),
  email: emailField.optional().or(z.literal("").transform(() => undefined)),
  countryCode: z.string().trim().length(2).toUpperCase(),
  currency: z.string().trim().length(3).toUpperCase(),
  timezone: z.string().trim().min(1),
  addressLine: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  city: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
  district: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  businessType: businessTypeEnum,
}).superRefine((v, ctx) => {
  if (v.phone && !isValidPhone(v.phone, v.countryCode)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["phone"],
      message: "Numéro de téléphone invalide pour ce pays.",
    });
  }
});

// ── Membres & invitations ────────────────────────────────────────────

/** Rôles attribuables via invitation / changement de rôle — jamais OWNER.
 *  Source unique : ASSIGNABLE_ROLES (src/server/tenant/ownership.ts). */
export const invitableRoleEnum = z.enum(
  ASSIGNABLE_ROLES as unknown as [AssignableRole, ...AssignableRole[]],
);

export const createInvitationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .max(80)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    phone: phoneField,
    countryCode: z.string().trim().length(2).toUpperCase().default("ML"),
    email: emailField.optional().or(z.literal("").transform(() => undefined)),
    role: invitableRoleEnum,
  })
  .superRefine((v, ctx) => {
    if (!isValidPhone(v.phone, v.countryCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Numéro de téléphone invalide pour ce pays.",
      });
    }
  });

export const updateMemberRoleSchema = z.object({
  membershipId: z.string().min(1),
  role: invitableRoleEnum,
});

export const membershipIdSchema = z.object({
  membershipId: z.string().min(1),
});

export const invitationIdSchema = z.object({
  invitationId: z.string().min(1),
});

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(10),
    // Champs de création de compte si l'invité n'a pas encore de compte.
    firstName: nameField.optional(),
    lastName: nameField.optional(),
    password: passwordField.optional(),
  })
  .transform((v) => v);

// ── Phase 2 : catalogue & stock ──────────────────────────────────────

export const productUnitEnum = z.enum([
  "UNIT",
  "SAC",
  "CARTON",
  "PAQUET",
  "BIDON",
  "LITRE",
  "KG",
  "BOITE",
  "BOUTEILLE",
  "LOT",
  "PALETTE",
  "ROULEAU",
  "OTHER",
]);

/** Montant entier (FCFA) — accepte "31 500", "31500", nombre. */
const intAmount = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[\s  ]/g, "");
    return cleaned === "" ? undefined : Number(cleaned);
  }
  return v;
}, z.number({ invalid_type_error: "Montant invalide" }).int("Montant entier attendu").nonnegative("Montant négatif"));

const optionalIntAmount = z.preprocess((v) => {
  if (v === "" || v == null) return undefined;
  if (typeof v === "string") {
    const cleaned = v.replace(/[\s  ]/g, "");
    return cleaned === "" ? undefined : Number(cleaned);
  }
  return v;
}, z.number({ invalid_type_error: "Montant invalide" }).int().nonnegative().optional());

const nonNegInt = z.preprocess((v) => {
  if (v === "" || v == null) return 0;
  if (typeof v === "string") return Number(v.replace(/[\s  ]/g, ""));
  return v;
}, z.number({ invalid_type_error: "Nombre invalide" }).int("Entier attendu").nonnegative("Nombre négatif"));

const positiveInt = z.preprocess((v) => {
  if (typeof v === "string") return Number(v.replace(/[\s  ]/g, ""));
  return v;
}, z.number({ invalid_type_error: "Nombre invalide" }).int("Entier attendu").positive("Quantité positive attendue"));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal("").transform(() => undefined));

const optionalUrl = z
  .string()
  .trim()
  .url("URL invalide")
  .max(500)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, "Au moins 2 caractères").max(60),
  description: optionalText(500),
});

const productBase = {
  name: z.string().trim().min(2, "Au moins 2 caractères").max(160),
  sku: z.string().trim().min(1, "SKU requis").max(48),
  categoryId: z
    .string()
    .trim()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  unit: productUnitEnum.default("UNIT"),
  unitLabel: optionalText(40),
  salePrice: intAmount,
  purchasePrice: optionalIntAmount,
  alertThreshold: nonNegInt.default(0),
  supplierName: optionalText(120),
  barcode: optionalText(64),
  description: optionalText(2000),
  photoUrl: optionalUrl,
};

export const createProductSchema = z.object({
  ...productBase,
  initialStock: nonNegInt.default(0),
});

export const updateProductSchema = z.object(productBase);

export const productIdSchema = z.object({ productId: z.string().min(1) });

const manualMovementTypeEnum = z.enum([
  "PURCHASE",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "RETURN_IN",
  "RETURN_OUT",
]);

/** Deux modes : quantité directe, ou inventaire (stock compté → delta serveur). */
export const stockMovementSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("quantity"),
    productId: z.string().min(1),
    type: manualMovementTypeEnum,
    quantity: positiveInt,
    reason: optionalText(200),
    reference: optionalText(80),
  }),
  z.object({
    mode: z.literal("inventory"),
    productId: z.string().min(1),
    countedStock: nonNegInt,
    reason: optionalText(200),
    reference: optionalText(80),
  }),
]);

export const reverseMovementSchema = z.object({
  movementId: z.string().min(1),
  reason: optionalText(200),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;

// ── Phase 3 : CRM & commandes ────────────────────────────────────────

export const customerTypeEnum = z.enum([
  "PARTICULIER",
  "DETAILLANT",
  "GROSSISTE",
  "REVENDEUR",
  "ENTREPRISE",
  "AUTRE",
]);

const optionalPhone = phoneField
  .optional()
  .or(z.literal("").transform(() => undefined));

const customerBase = {
  firstName: optionalText(80),
  lastName: optionalText(80),
  businessName: optionalText(120),
  phone: optionalPhone,
  email: emailField.optional().or(z.literal("").transform(() => undefined)),
  customerType: customerTypeEnum
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: optionalText(200),
  city: optionalText(120),
  area: optionalText(120),
  notes: optionalText(2000),
  assignedToUserId: optionalText(64),
};

export const createCustomerSchema = z
  .object(customerBase)
  .superRefine((v, ctx) => {
    if (!v.firstName && !v.lastName && !v.businessName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstName"],
        message: "Renseignez au moins un nom ou une boutique.",
      });
    }
  });

export const updateCustomerSchema = createCustomerSchema;

export const quickCreateCustomerSchema = z.object({
  displayName: z.string().trim().min(2, "Nom requis").max(120),
  phone: optionalPhone,
});

export const customerIdSchema = z.object({ customerId: z.string().min(1) });
export const orderIdSchema = z.object({ orderId: z.string().min(1) });

const orderLinesField = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Articles invalides" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.coerce
            .number()
            .int("Quantité entière")
            .positive("Quantité positive"),
        }),
      )
      .min(1, "Ajoutez au moins un article"),
  );

const orderCommonFields = {
  discountAmount: nonNegInt.default(0),
  deliveryFee: nonNegInt.default(0),
  notes: optionalText(2000),
  deliveryAddress: optionalText(200),
  deliveryArea: optionalText(120),
  requestedDeliveryAt: optionalText(40),
};

export const createOrderSchema = z.object({
  customerId: z.string().min(1, "Choisissez un client"),
  items: orderLinesField,
  ...orderCommonFields,
});

export const updateOrderItemsSchema = z.object({
  orderId: z.string().min(1),
  items: orderLinesField,
  discountAmount: nonNegInt.default(0),
  deliveryFee: nonNegInt.default(0),
  notes: optionalText(2000),
});

export const transitionOrderSchema = z.object({
  orderId: z.string().min(1),
  to: z.enum([
    "PENDING_CONFIRMATION",
    "CONFIRMED",
    "PREPARING",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "CANCELLED",
    "REJECTED",
  ]),
  reason: optionalText(300),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateOrderFormInput = z.infer<typeof createOrderSchema>;

// ── Phase 4 : créances, paiements, relances ──────────────────────────

export const paymentMethodEnum = z.enum([
  "CASH",
  "BANK_TRANSFER",
  "MOBILE_MONEY",
  "CHEQUE",
  "CARD",
  "OTHER",
]);

export const paymentProviderEnum = z.enum([
  "WAVE",
  "ORANGE_MONEY",
  "MOOV",
  "OTHER",
]);

/** Liste d'identifiants : JSON `["a","b"]` ou liste séparée par des virgules. */
const idListField = z
  .string()
  .trim()
  .optional()
  .transform((raw) => {
    if (!raw) return [] as string[];
    let parsed: unknown = null;
    if (raw.startsWith("[")) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    const list = Array.isArray(parsed) ? parsed : raw.split(",");
    return [
      ...new Set(
        list
          .map((s) => String(s).trim())
          .filter((s) => s.length > 0),
      ),
    ];
  });

export const recordPaymentSchema = z.object({
  customerId: z.string().min(1, "Client requis"),
  orderId: z
    .string()
    .trim()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  amount: positiveInt,
  method: paymentMethodEnum.default("CASH"),
  provider: paymentProviderEnum
    .optional()
    .or(z.literal("").transform(() => undefined)),
  reference: optionalText(80),
  notes: optionalText(500),
  paidAt: optionalText(40),
});

export const cancelPaymentSchema = z.object({
  paymentId: z.string().min(1),
  reason: optionalText(300),
});

export const updateDueDateSchema = z.object({
  orderId: z.string().min(1),
  dueDate: optionalText(40),
});

export const createReminderCampaignSchema = z.object({
  name: optionalText(120),
  orderIds: idListField,
  customerIds: idListField,
});

export const campaignIdSchema = z.object({ campaignId: z.string().min(1) });

export type RecordPaymentFormInput = z.infer<typeof recordPaymentSchema>;

// ── Phase 5 : WhatsApp & conversations ───────────────────────────────

export const whatsAppProviderEnum = z.enum(["META_CLOUD", "MOCK"]);
export const conversationModeEnum = z.enum(["AUTO", "HUMAN", "PAUSED"]);

export const connectWhatsAppSchema = z
  .object({
    provider: whatsAppProviderEnum.default("META_CLOUD"),
    phoneNumberId: z.string().trim().min(1, "Phone Number ID requis").max(64),
    businessAccountId: optionalText(64),
    displayPhoneNumber: optionalText(32),
    verifiedName: optionalText(120),
    accessToken: z
      .string()
      .trim()
      .max(4096)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .superRefine((v, ctx) => {
    if (v.provider === "META_CLOUD" && !v.accessToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessToken"],
        message: "Un access token est requis pour l'API Cloud.",
      });
    }
  });

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().trim().min(1, "Message vide").max(4096, "Message trop long"),
});

export const assignConversationSchema = z.object({
  conversationId: z.string().min(1),
  assigneeUserId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const setConversationModeSchema = z.object({
  conversationId: z.string().min(1),
  mode: conversationModeEnum,
});

export const conversationIdSchema = z.object({
  conversationId: z.string().min(1),
});

// ── Phase 6 : Djeli IA ──────────────────────────────────────────────

export const askAssistantSchema = z.object({
  question: z.string().trim().min(2, "Posez une question").max(1000),
  // Présents seulement si la question vient du micro ET a été éditée avant
  // envoi — signal de correction pour le Language Core (§31).
  voiceOriginalText: z.string().trim().max(1000).optional(),
  voiceLanguage: z.enum(["FR", "BM", "MIXED", "UNKNOWN"]).optional(),
});

export const orderDraftIdSchema = z.object({
  draftId: z.string().min(1),
  reason: optionalText(300),
});

export const aiProposalIdSchema = z.object({
  proposalId: z.string().min(1),
});

// ── Phase 6B : Djeli Voice ──────────────────────────────────────────

export const correctTranscriptionSchema = z.object({
  messageId: z.string().min(1),
  correctedText: z.string().trim().min(1, "Texte requis").max(4000),
});

export const retranscribeSchema = z.object({
  messageId: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
