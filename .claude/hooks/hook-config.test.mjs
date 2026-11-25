// node --test ".claude/hooks/*.test.mjs"   (also run in CI)
//
// Runs the exact hook commands from .claude/settings.json and .codex/hooks.json
// through a shell, the way the agents do, to check that they fail closed: if
// node can't run, the command must exit 2 (block the tool call) instead of
// failing open.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const nodeDir = dirname(process.execPath);

const commandsFrom = (file) =>
  JSON.parse(readFileSync(join(repo, file), "utf8")).hooks.PreToolUse.flatMap((group) =>
    group.hooks.map((h) => ({ file, command: h.command, secrets: h.command.includes("protect-secrets") })),
  );

const hooks = [...commandsFrom(".claude/settings.json"), ...commandsFrom(".codex/hooks.json")];

const run = (command, payload, path) =>
  spawnSync("sh", ["-c", command], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { PATH: path, CLAUDE_PROJECT_DIR: repo, HOME: process.env.HOME ?? "" },
  });

const secretRead = { tool_name: "Read", tool_input: { file_path: "api/config/master.key" } };
const harmless = { tool_name: "Bash", tool_input: { command: "git status -sb" }, cwd: repo };

describe("hook commands", () => {
  it("are configured for both agents", () => {
    assert.equal(hooks.filter((h) => h.file === ".claude/settings.json").length, 2);
    assert.equal(hooks.filter((h) => h.file === ".codex/hooks.json").length, 2);
  });

  for (const { file, command, secrets } of hooks) {
    const name = `${file} ${secrets ? "protect-secrets" : "protect-main"}`;

    it(`${name}: blocks (exit 2) when node is missing`, () => {
      const out = run(command, harmless, "/usr/bin:/bin");
      assert.equal(out.status, 2, out.stderr);
      assert.match(out.stderr, /safety hook could not run/);
    });

    it(`${name}: allows a harmless call when node works`, () => {
      const out = run(command, harmless, `${nodeDir}:/usr/bin:/bin`);
      assert.equal(out.status, 0, out.stderr);
      assert.equal(out.stdout, "");
    });

    if (secrets) {
      it(`${name}: denies a secret read when node works`, () => {
        const out = run(command, secretRead, `${nodeDir}:/usr/bin:/bin`);
        assert.equal(out.status, 0, out.stderr);
        assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, "deny");
      });
    }
  }
});
