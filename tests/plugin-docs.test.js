import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")

test("V1 system prompt replaces every Superpowers docs root with docs", () => {
  const script = `
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    import mod from "./packages/opencode/src/index.js";
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-v1-docs-test-"));
    try {
      const plugin = await mod.server({ omagents: {
        jobStorePath: path.join(storage, "job-board.json"),
        tuiStatePath: path.join(storage, "tui-state.json")
      } });
      const output = { system: [] };
      await plugin["experimental.chat.system.transform"]({}, output);
      console.log(JSON.stringify(output.system));
    } finally {
      fs.rmSync(storage, { recursive: true, force: true });
    }
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, SHELL: "omagents-test-shell" },
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split("\n")
  const system = JSON.parse(lines.at(-1))

  assert.ok(
    system.some(
      (part) =>
        typeof part === "string" &&
        part.includes("replace every `docs/superpowers` path prefix with `docs`") &&
        part.includes("`docs/specs/`") &&
        part.includes("`docs/plans/`")
    ),
    "V1 must receive the same future-proof documentation-path preference"
  )
})
