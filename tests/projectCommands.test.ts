import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildProjectCommandProfile, selectValidationCommands } from "../src/core/commandProfile.js";

test("package.json scripts generate a project command profile", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-profile-node-"));
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({
    scripts: {
      typecheck: "tsc --noEmit",
      test: "node --test",
      lint: "eslint .",
      build: "tsc",
      dev: "node src/index.js"
    }
  }), "utf8");

  const profile = await buildProjectCommandProfile(workspace);
  assert.equal(profile.detections[0]?.type, "node");
  assert.equal(profile.commands.typecheck, "npm run typecheck");
  assert.equal(profile.commands.test, "npm test");
  assert.deepEqual(selectValidationCommands(profile), [
    "npm run typecheck",
    "npm run lint",
    "npm test",
    "npm run build"
  ]);
});

test("empty workspace reports missing validation commands", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-profile-empty-"));
  const profile = await buildProjectCommandProfile(workspace);
  assert.equal(profile.detections.length, 0);
  assert.equal(selectValidationCommands(profile).length, 0);
  assert.match(profile.warnings.join("\n"), /No known project files/);
});
