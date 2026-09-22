import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests d'INTÉGRATION Djeli Learning Loop (§6D, §34, §55) — INVARIANT CLÉ :
 * la promotion d'un candidat ne crée JAMAIS une entrée VALIDATED ni une entrée
 * GLOBAL automatiquement. Elle produit une entrée SUGGESTED dans le scope
 * suggéré, qu'un humain devra valider séparément.
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
  approve: typeof import("../src/language-core/learning/review-service.ts")["approveCandidate"];
  promote: typeof import("../src/language-core/learning/promotion-service.ts")["promoteLearningCandidate"];
};
let d: Deps;

const TAG = `${Date.now()}`;
const REF = `test:${TAG}`;
const ORG = `it-ll-org-${TAG}`;
const TERM = `dolo${TAG}`;
let candidateId = "";
const actorScope = { organizationId: ORG, isSuperAdmin: false };

before(async () => {
  if (!ENABLED) return;
  const [{ lcDb }, rev, promo] = await Promise.all([
    import("../src/language-core/db.ts"),
    import("../src/language-core/learning/review-service.ts"),
    import("../src/language-core/learning/promotion-service.ts"),
  ]);
  d = { lcDb, approve: rev.approveCandidate, promote: promo.promoteLearningCandidate };

  const now = new Date();
  const c = await d.lcDb.learningCandidate.create({
    data: {
      dedupeKey: `dk-${TAG}`,
      language: "BM",
      scopeSuggestion: "ORGANIZATION",
      organizationId: ORG,
      candidateType: "NEW_ENTRY",
      canonicalText: TERM,
      normalizedText: TERM,
      proposedMeaning: "bière de mil",
      occurrenceCount: 5,
      organizationCount: 1,
      correctionCount: 3,
      confidenceScore: 0.7,
      evidenceSummary: {},
      firstSeenAt: now,
      lastSeenAt: now,
      status: "NEW",
    },
  });
  candidateId = c.id;
});

after(async () => {
  if (!ENABLED || !d?.lcDb) return;
  await d.lcDb.learningReview.deleteMany({ where: { candidateId } }).catch(() => {});
  await d.lcDb.learningCandidate.deleteMany({ where: { dedupeKey: `dk-${TAG}` } }).catch(() => {});
  await d.lcDb.languageAuditLog.deleteMany({ where: { actorRef: REF } }).catch(() => {});
  await d.lcDb.languageEntry.deleteMany({ where: { createdByRef: REF } }).catch(() => {});
  await d.lcDb.$disconnect();
});

test("un candidat NEW ne peut pas être promu directement", suiteOpts, async () => {
  await assert.rejects(
    () => d.promote({ candidateId, actorRef: REF }, actorScope),
    /APPROVED peut être promu/i,
  );
});

test("approve → promote : entrée SUGGESTED dans le scope suggéré, JAMAIS VALIDATED ni GLOBAL", suiteOpts, async () => {
  const approved = await d.approve({ candidateId, actorRef: REF }, actorScope);
  assert.equal(approved.status, "APPROVED");

  const res = await d.promote({ candidateId, actorRef: REF }, actorScope);
  assert.equal(res.kind, "entry");

  const entry = await d.lcDb.languageEntry.findUniqueOrThrow({ where: { id: res.entryId } });
  assert.notEqual(entry.status, "VALIDATED", "INVARIANT : jamais VALIDATED automatiquement");
  assert.equal(entry.status, "SUGGESTED");
  assert.notEqual(entry.scope, "GLOBAL", "INVARIANT : jamais GLOBAL automatiquement");
  assert.equal(entry.scope, "ORGANIZATION");
  assert.equal(entry.organizationId, ORG);
  assert.equal(entry.meaning, "bière de mil");

  const cand = await d.lcDb.learningCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  assert.equal(cand.status, "PROMOTED");
  assert.equal(cand.promotedEntryId, res.entryId);
});

test("promotion idempotente : re-promouvoir renvoie la même entrée, sans doublon", suiteOpts, async () => {
  const countBefore = await d.lcDb.languageEntry.count({ where: { createdByRef: REF } });
  const again = await d.promote({ candidateId, actorRef: REF }, actorScope);
  assert.equal(again.kind, "already");
  const countAfter = await d.lcDb.languageEntry.count({ where: { createdByRef: REF } });
  assert.equal(countAfter, countBefore, "aucune entrée supplémentaire créée");
});

test("approuver un candidat déjà promu est refusé", suiteOpts, async () => {
  await assert.rejects(() => d.approve({ candidateId, actorRef: REF }, actorScope), /déjà promu/i);
});
