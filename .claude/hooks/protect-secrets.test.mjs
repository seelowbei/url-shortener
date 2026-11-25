// node --test ".claude/hooks/*.test.mjs"   (also run in CI)
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { check } from "./protect-secrets.mjs";

describe("check", () => {
  const blocked = [
    ["Read master.key", "Read", { file_path: "/repo/api/config/master.key" }],
    ["Read an environment credentials key", "Read", { file_path: "api/config/credentials/production.key" }],
    ["Read .env", "Read", { file_path: "/repo/api/.env" }],
    ["Edit .env.local", "Edit", { file_path: "web/.env.local" }],
    ["Write a .pem", "Write", { file_path: "infra/oci_api_key.pem" }],
    ["Grep inside .env", "Grep", { path: "api/.env" }],
    ["Grep with a .key glob", "Grep", { glob: "**/*.key" }],
    ["cat master.key", "Bash", { command: "cat api/config/master.key" }],
    ["cat .env", "Bash", { command: "cd api && cat .env" }],
    ["argv form", "Bash", { command: ["bash", "-lc", "cat .env.production"] }],
    ["credentials:show", "Bash", { command: "bin/rails credentials:show" }],
    ["kamal secrets print", "Bash", { command: "bin/kamal secrets print -d staging" }],
    ["pulumi --show-secrets", "Bash", { command: "pulumi stack output --show-secrets -s prod" }],
    ["apply_patch on .env", "apply_patch", { command: "*** Begin Patch\n*** Update File: api/.env\n@@\n-A=1\n+A=2\n*** End Patch" }],
  ];
  for (const [name, tool, input] of blocked) {
    it(`blocks ${name}`, () => assert.ok(check(tool, input), name));
  }

  const allowed = [
    ["Read a normal file", "Read", { file_path: "api/config/database.yml" }],
    ["Read the encrypted credentials", "Read", { file_path: "api/config/credentials.yml.enc" }],
    ["Read .env.sample", "Read", { file_path: "api/.env.sample" }],
    ["Read .env.example", "Read", { file_path: "web/.env.example" }],
    ["Read .kamal/secrets (references only)", "Read", { file_path: "api/.kamal/secrets" }],
    ["ENV.fetch in Ruby", "Bash", { command: `grep -rn "ENV.fetch" api/config` }],
    ["process.env in JS", "Bash", { command: "node -e 'console.log(process.env.NODE_ENV)'" }],
    ["git status", "Bash", { command: "git status -sb" }],
    ["rspec", "Bash", { command: "cd api && bin/rspec" }],
    ["pulumi preview", "Bash", { command: "pulumi preview -s staging" }],
    ["apply_patch to docs mentioning master.key", "apply_patch", { command: "*** Begin Patch\n*** Update File: AGENTS.md\n@@\n+never read master.key\n*** End Patch" }],
    ["other tools", "WebSearch", { query: ".env" }],
  ];
  for (const [name, tool, input] of allowed) {
    it(`allows ${name}`, () => assert.equal(check(tool, input), null, name));
  }
});

describe("hook script", () => {
  const script = new URL("./protect-secrets.mjs", import.meta.url).pathname;
  const run = (payload) => spawnSync("node", [script], { input: payload, encoding: "utf8" });

  it("denies a secret read with a PreToolUse decision", () => {
    const out = run(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "api/config/master.key" } }));
    assert.equal(out.status, 0);
    assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, "deny");
  });

  it("stays silent for allowed calls and bad input", () => {
    assert.equal(run(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "README.md" } })).stdout, "");
    assert.equal(run("not json").stdout, "");
  });
});
