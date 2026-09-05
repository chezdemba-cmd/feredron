import { test } from "node:test";
import assert from "node:assert/strict";
import { getEnv, inspectEnv } from "../src/lib/env.ts";

test("deployment environment handles blank optional values without bypassing validation", () => {
  const original = process.env;
  process.env = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:password@localhost:5432/test",
    AUTH_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    APP_ENV: "staging",
    DEMO_OWNER_PASSWORD: "",
    DEMO_ADMIN_PASSWORD: "",
    DEMO_MANAGER_PASSWORD: "",
    DEMO_SALES_PASSWORD: "",
    DEMO_EMPLOYEE_PASSWORD: "",
    DEMO_ALLOW_EXTERNAL_SEND: "",
    MOBILE_APP_ID: "",
    STAGING_API_URL: "   ",
    PRODUCTION_API_URL: "",
    AI_API_KEY: "",
  };
  try {
    assert.deepEqual(inspectEnv(), { ok: true, issues: [] });

    process.env.PRODUCTION_API_URL = "not-a-url";
    assert.ok(inspectEnv().issues.some((issue) => issue.startsWith("PRODUCTION_API_URL:")));
    process.env.PRODUCTION_API_URL = "";

    const secret = process.env.AUTH_SESSION_SECRET;
    process.env.AUTH_SESSION_SECRET = "";
    assert.ok(inspectEnv().issues.some((issue) => issue.startsWith("AUTH_SESSION_SECRET:")));
    process.env.AUTH_SESSION_SECRET = secret;

    const database = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "";
    assert.ok(inspectEnv().issues.some((issue) => issue.startsWith("DATABASE_URL:")));
    process.env.DATABASE_URL = database;

    process.env.APP_ENV = "production";
    process.env.AI_PROVIDER = "openai-compatible";
    assert.ok(inspectEnv().issues.some((issue) => issue.includes("AI_API_KEY")));
    process.env.APP_ENV = "staging";

    const parsed = getEnv();
    assert.equal(parsed.DEMO_ADMIN_PASSWORD, undefined);
    assert.equal(parsed.DEMO_ALLOW_EXTERNAL_SEND, "false");
    assert.equal(parsed.MOBILE_APP_ID, "com.djeli.business");
    assert.equal(parsed.PRODUCTION_API_URL, undefined);
    assert.equal(parsed.AUTH_SESSION_SECRET, secret);
  } finally {
    process.env = original;
  }
});
