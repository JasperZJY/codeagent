import test from "node:test";
import assert from "node:assert/strict";
import { parseErrorLog } from "../src/core/errorParser.js";

test("parses TypeScript compiler errors", () => {
  const errors = parseErrorLog("src/core/runtime.ts(12,5): error TS2322: Type 'x' is not assignable.", "npm run typecheck");
  assert.equal(errors[0]?.file?.endsWith("src\\core\\runtime.ts") || errors[0]?.file?.endsWith("src/core/runtime.ts"), true);
  assert.equal(errors[0]?.line, 12);
  assert.equal(errors[0]?.column, 5);
  assert.equal(errors[0]?.type, "TS2322");
});

test("parses npm/node test failures", () => {
  const errors = parseErrorLog("not ok 1 - runtime\nAssertionError: Expected route list_dir, got answer\n    at tests/runtime.test.js:31:10", "npm test");
  assert.equal(errors.some((error) => error.type === "node-test"), true);
  assert.match(errors.map((error) => error.message).join("\n"), /Expected route/);
});

test("parses Python syntax errors", () => {
  const errors = parseErrorLog("  File \"py/agent_bridge.py\", line 7\n    bad code\nSyntaxError: invalid syntax", "python -m py_compile py/agent_bridge.py");
  assert.equal(errors[0]?.file?.endsWith("py\\agent_bridge.py") || errors[0]?.file?.endsWith("py/agent_bridge.py"), true);
  assert.equal(errors[0]?.line, 7);
});
