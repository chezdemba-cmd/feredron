import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests d'INTÉGRATION Djeli Language Core (§6C, §49-§52) :
 *  - `resolve` ne sert QUE des entrées VALIDATED ;
 *  - priorité de scope ORGANIZATION > GLOBAL, et une entrée ORGANIZATION d'une
 *    org n'est jamais servie à une autre org ;
 *  - garde-fous de forme de scope à la création ;
 *  - authentification des clients API (secret bcrypt, client inactif rejeté).
 *
 *   DATABASE_URL="postgresql://…/djeli_test" RUN_DB_TESTS=1 npm test
 */

const RUN = process.env.RUN_DB_TESTS === "1" || process.env.RUN_DB_TESTS === "true";
const DB_URL = process.env.DATABASE_URL ?? "";
const ENABLED = RUN && /(_test|_shadow|localhost|127\.0\.0\.1)/.test(DB_URL);
const suiteOpts = ENABLED
  ? {}
  : { skip: !RUN ? "RUN_DB_TESTS non défini" : "DATABASE_URL hors base de test" };

type Deps = {
  lcDb: import("@prisma/client").PrismaClient;
  createEntry: typeof import("../src/language-core/entry-service.ts")["createEntry"];
  validateEntry: typeof import("../src/language-core/entry-service.ts")["validateEntry"];
  resolveExpression: typeof import("../src/language-core/resolve-engine.ts")["resolveExpression"];
  provisionClient: typeof import("../src/language-core/auth-service.ts")["provisionClient"];
  authenticateRequest: typeof import("../src/language-core/auth-service.ts")["authenticateRequest"];
};
let d: Deps;

const TAG = `${Date.now()}`;
const TERM = `sikr${TAG}`; // texte canonique unique, résistant à la normalisation
const ORG_A = `it-lang-orgA-${TAG}`;
const ORG_B = `it-lang-orgB-${TAG}`;
const REF = `test:${TAG}`;
const ALL_SCOPES = ["ORGANIZATION", "DOMAIN", "GLOBAL"] as const;
// Périmètre « opérateur Djeli » pour le seed des tests — bypass volontaire du
// contrôle d'accès (§ access.ts) qui n'est pas l'objet de ces scénarios-ci.
const SUPER = { organizationId: "", isSuperAdmin: true };
const asOrgA = { organizationId: ORG_A, isSuperAdmin: false };
const asOrgB = { organizationId: ORG_B, isSuperAdmin: false };

before(async () => {
  if (!ENABLED) return;
  const [{ lcDb }, es, re, as] = await Promise.all([
    import("../src/language-core/db.ts"),
    import("../src/language-core/entry-service.ts"),
    import("../src/language-core/resolve-engine.ts"),
    import("../src/language-core/auth-service.ts"),
  ]);
  d = {
    lcDb,
    createEntry: es.createEntry,
    validateEntry: es.validateEntry,
    resolveExpression: re.resolveExpression,
    provisionClient: as.provisionClient,
    authenticateRequest: as.authenticateRequest,
  };
});

after(async () => {
  if (!ENABLED || !d?.lcDb) return;
  // Les revisions ont onDelete: Cascade depuis LanguageEntry.
  await d.lcDb.languageAuditLog.deleteMany({ where: { actorRef: REF } }).catch(() => {});
  await d.lcDb.languageEntry.deleteMany({ where: { createdByRef: REF } }).catch(() => {});
  await d.lcDb.languageApplicationClient
    .deleteMany({ where: { clientId: `test-client-${TAG}` } })
    .catch(() => {});
  await d.lcDb.languageApplication.deleteMany({ where: { code: `TEST_APP_${TAG}` } }).catch(() => {});
  await d.lcDb.$disconnect();
});

test("resolve ne sert pas une entrée SUGGESTED ; sert l'entrée une fois VALIDATED", suiteOpts, async () => {
  const g = await d.createEntry(
    {
      canonicalText: TERM,
      language: "BM",
      scope: "GLOBAL",
      meaning: "sucre",
      status: "SUGGESTED",
      createdByRef: REF,
    },
    SUPER,
  );

  let r = await d.resolveExpression({ text: TERM, ctx: { allowedScopes: [...ALL_SCOPES] } });
  assert.equal(r.matched, false, "SUGGESTED n'est jamais résolu");

  await d.validateEntry({ entryId: g.id, actorRef: REF }, SUPER);
  r = await d.resolveExpression({ text: TERM, ctx: { allowedScopes: [...ALL_SCOPES] } });
  assert.equal(r.matched, true);
  assert.equal(r.scope, "GLOBAL");
  assert.equal(r.meaning, "sucre");
});

test("priorité ORGANIZATION > GLOBAL, et isolation inter-org", suiteOpts, async () => {
  const orgEntry = await d.createEntry(
    {
      canonicalText: TERM,
      language: "BM",
      scope: "ORGANIZATION",
      organizationId: ORG_A,
      meaning: "sucre en poudre 1kg",
      status: "SUGGESTED",
      createdByRef: REF,
    },
    asOrgA,
  );
  await d.validateEntry({ entryId: orgEntry.id, actorRef: REF }, asOrgA);

  const asA = await d.resolveExpression({
    text: TERM,
    ctx: { organizationId: ORG_A, allowedScopes: [...ALL_SCOPES] },
  });
  assert.equal(asA.matched, true);
  assert.equal(asA.scope, "ORGANIZATION");
  assert.equal(asA.meaning, "sucre en poudre 1kg", "l'entrée de l'org appelante gagne");

  const asB = await d.resolveExpression({
    text: TERM,
    ctx: { organizationId: ORG_B, allowedScopes: [...ALL_SCOPES] },
  });
  assert.equal(asB.matched, true);
  assert.equal(asB.scope, "GLOBAL", "org B ne voit pas l'entrée ORGANIZATION de A → retombe sur GLOBAL");
  assert.equal(asB.meaning, "sucre");
});

test("garde-fous de forme de scope à la création", suiteOpts, async () => {
  await assert.rejects(
    () =>
      d.createEntry(
        {
          canonicalText: `x${TAG}`,
          language: "BM",
          scope: "GLOBAL",
          organizationId: ORG_A,
          createdByRef: REF,
        },
        SUPER,
      ),
    /GLOBAL ne porte ni organizationId/i,
  );
  await assert.rejects(
    () =>
      d.createEntry(
        {
          canonicalText: `y${TAG}`,
          language: "BM",
          scope: "ORGANIZATION",
          createdByRef: REF,
        },
        asOrgA,
      ),
    /ORGANIZATION exige un organizationId/i,
  );
});

test("IDOR : une organisation ne peut ni lire-modifier ni usurper l'organizationId d'une autre", suiteOpts, async () => {
  // Création : un acteur non-superadmin ne peut pas créer une entrée
  // ORGANIZATION pour une autre organisation que la sienne, même s'il
  // fournit explicitement l'organizationId d'une autre (spoof).
  const spoofed = await d.createEntry(
    {
      canonicalText: `spoof${TAG}`,
      language: "BM",
      scope: "ORGANIZATION",
      organizationId: ORG_B, // tentative de spoof : acteur = ORG_A
      createdByRef: REF,
    },
    asOrgA,
  );
  const stored = await d.lcDb.languageEntry.findUniqueOrThrow({ where: { id: spoofed.id } });
  assert.equal(stored.organizationId, ORG_A, "organizationId forcé à celui de l'acteur, jamais celui fourni");

  // Mutation : ORG_B ne peut ni valider ni modifier une entrée ORGANIZATION
  // appartenant à ORG_A, même en connaissant son id.
  const privateToA = await d.createEntry(
    {
      canonicalText: `private${TAG}`,
      language: "BM",
      scope: "ORGANIZATION",
      organizationId: ORG_A,
      createdByRef: REF,
    },
    asOrgA,
  );
  await assert.rejects(() => d.validateEntry({ entryId: privateToA.id, actorRef: REF }, asOrgB));
  // Un opérateur Djeli (superadmin), lui, le peut toujours.
  await d.validateEntry({ entryId: privateToA.id, actorRef: REF }, SUPER);
});

test("auth client API : secret bcrypt, mauvais secret et client inactif rejetés", suiteOpts, async () => {
  const clientId = `test-client-${TAG}`;
  const secret = `s3cr3t-${TAG}-longenough`;
  await d.provisionClient({
    applicationCode: `TEST_APP_${TAG}`,
    applicationName: "Test App",
    clientName: "Test Client",
    clientId,
    secret,
    permissions: ["language.read"],
    allowedDomains: [],
    allowedScopes: ["GLOBAL"],
  });

  const ok = await d.authenticateRequest(`Bearer ${clientId}.${secret}`);
  assert.equal(ok.ok, true);

  const bad = await d.authenticateRequest(`Bearer ${clientId}.wrong-secret`);
  assert.equal(bad.ok, false);
  assert.equal((bad as { ok: false; error: { status: number } }).error.status, 401);

  await d.lcDb.languageApplicationClient.update({
    where: { clientId },
    data: { status: "SUSPENDED" },
  });
  const suspended = await d.authenticateRequest(`Bearer ${clientId}.${secret}`);
  assert.equal(suspended.ok, false);
});
