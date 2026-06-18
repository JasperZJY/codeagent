import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializeProject } from "../src/core/projectInit.js";

test("/init project initialization writes project, rules, and commands docs", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-init-"));
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify({
      scripts: {
        typecheck: "tsc -p tsconfig.json --noEmit",
        test: "node --test",
        build: "tsc -p tsconfig.json",
        dev: "tsx src/index.ts"
      }
    }, null, 2),
    "utf8"
  );
  await writeFile(path.join(workspace, "src", "index.ts"), "export function main() { return 1; }\n", "utf8");

  const result = await initializeProject(workspace);

  assert.equal(result.outlineFiles, 1);
  assert.equal(result.profile.commands.typecheck, "npm run typecheck");
  assert.equal(result.profile.commands.test, "npm test");
  assert.match(await readFile(result.projectPath, "utf8"), /技术栈/);
  assert.match(await readFile(result.rulesPath, "utf8"), /禁止修改的目录/);
  assert.match(await readFile(result.commandsPath, "utf8"), /npm run typecheck/);
});
