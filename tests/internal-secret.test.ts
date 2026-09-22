import { test } from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqualString } from "../src/server/security/internal-secret.ts";

test("timingSafeEqualString : égalité et inégalité, y compris longueurs différentes", () => {
  assert.equal(timingSafeEqualString("abc", "abc"), true);
  assert.equal(timingSafeEqualString("abc", "abd"), false);
  assert.equal(timingSafeEqualString("abc", "abcd"), false);
  assert.equal(timingSafeEqualString("", ""), true);
});
