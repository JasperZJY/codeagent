import test from "node:test";
import assert from "node:assert/strict";
import { parseReflectionReport } from "../src/core/reflection.js";

test("parses reflection JSON with qwen thinking tags", () => {
  const report = parseReflectionReport(
    "<think>hidden</think>{\"verdict\":\"revise\",\"issues\":[\"missing test\"],\"nextActions\":[\"run tests\"],\"lessons\":[\"verify changes\"]}"
  );
  assert.ok(report);
  assert.equal(report.verdict, "revise");
  assert.deepEqual(report.lessons, ["verify changes"]);
});
