import { test } from "node:test";
import assert from "node:assert/strict";

/** Capture console.* le temps d'un appel. */
function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  console.warn = (...a: unknown[]) => lines.push(a.join(" "));
  console.error = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    fn();
  } finally {
    Object.assign(console, orig);
  }
  return lines;
}

test("§24 : logger émet une ligne JSON structurée avec ts/level/msg", async () => {
  process.env.LOG_LEVEL = "info";
  const { logger } = await import("../src/lib/logger.ts");
  const [line] = capture(() => logger.info("thing.happened", { service: "svc", event: "e", organizationId: "org_1" }));
  const parsed = JSON.parse(line!);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.msg, "thing.happened");
  assert.equal(parsed.service, "svc");
  assert.equal(parsed.organizationId, "org_1");
  assert.ok(parsed.ts);
});

test("§24 : les champs sensibles sont masqués", async () => {
  const { logger } = await import("../src/lib/logger.ts");
  const [line] = capture(() =>
    logger.warn("auth.try", { token: "abc123", apiKey: "k", password: "p", note: "ok" }),
  );
  const parsed = JSON.parse(line!);
  assert.equal(parsed.token, "[redacted]");
  assert.equal(parsed.apiKey, "[redacted]");
  assert.equal(parsed.password, "[redacted]");
  assert.equal(parsed.note, "ok");
});

test("les valeurs qui ressemblent à un secret sont masquées même sous une clé neutre", async () => {
  const { logger } = await import("../src/lib/logger.ts");
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const hexKey = "a".repeat(64);
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const [line] = capture(() =>
    logger.info("thing", { details: jwt, payload: hexKey, requestId: uuid, note: "commande #42" }),
  );
  const parsed = JSON.parse(line!);
  assert.equal(parsed.details, "[redacted]");
  assert.equal(parsed.payload, "[redacted]");
  assert.equal(parsed.requestId, uuid, "un UUID ordinaire n'est pas un secret");
  assert.equal(parsed.note, "commande #42");
});

test("le seuil LOG_LEVEL filtre les niveaux inférieurs", async () => {
  process.env.LOG_LEVEL = "warn";
  const { logger } = await import("../src/lib/logger.ts");
  const lines = capture(() => {
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
  });
  assert.equal(lines.length, 2);
});

test("§25 : installErrorTracking est idempotent et gère l'absence de SENTRY_DSN sans erreur", async () => {
  delete process.env.SENTRY_DSN;
  const { installErrorTracking } = await import("../src/server/observability/error-tracking.ts");
  assert.doesNotThrow(() => {
    installErrorTracking();
    installErrorTracking();
  });
});
