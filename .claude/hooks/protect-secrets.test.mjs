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
    // globs that could expand to a secret file
    ["a *.key glob", "Bash", { command: "cat api/config/*.key" }],
    ["a master.* glob", "Bash", { command: "cat config/master.*" }],
    ["a partial name glob", "Bash", { command: "cat config/master.k*" }],
    ["a ? glob", "Bash", { command: "cat config/master.ke?" }],
    ["a brace glob", "Bash", { command: "cat config/master.{key,txt}" }],
    ["a char-class glob", "Bash", { command: "head -c 32 config/[m]aster.key" }],
    ["a .env* glob", "Bash", { command: "cat api/.env*" }],
    ["a *.pem glob", "Bash", { command: "ls ~/.oci && cat ~/.oci/*.pem" }],
    ["find with a *.key name", "Bash", { command: `find . -name "*.key" -exec cat {} +` }],
    ["a quoted-apart file name", "Bash", { command: `cat config/"mas"'ter.key'` }],
    // decrypted credentials without naming the key file
    ["credentials:edit", "Bash", { command: "EDITOR=cat bin/rails credentials:edit" }],
    ["credentials:diff", "Bash", { command: "bin/rails credentials:diff" }],
    ["rails runner printing credentials", "Bash", { command: `bin/rails runner 'puts Rails.application.credentials.config'` }],
    ["rails runner printing secret_key_base", "Bash", { command: `bin/rails runner "p Rails.application.secret_key_base"` }],
    ["ruby -e with EncryptedConfiguration", "Bash", { command: `ruby -e 'ActiveSupport::EncryptedConfiguration.new(**opts).read'` }],
    ["secret_key_base anywhere", "Bash", { command: "bin/rails r 'puts Rails.configuration.secret_key_base'" }],
    // secret environment variables
    ["echo $RAILS_MASTER_KEY", "Bash", { command: "echo $RAILS_MASTER_KEY" }],
    ["${RAILS_MASTER_KEY}", "Bash", { command: `echo "key=\${RAILS_MASTER_KEY}"` }],
    ["printenv RAILS_MASTER_KEY", "Bash", { command: "printenv RAILS_MASTER_KEY" }],
    ["a *_TOKEN variable", "Bash", { command: "curl -H \"Authorization: Bearer $VERCEL_TOKEN\" https://api.vercel.com" }],
    ["POSTGRES_PASSWORD", "Bash", { command: "psql postgres://u:$POSTGRES_PASSWORD@db" }],
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
    // globs that can't expand to a secret
    ["the hook test glob", "Bash", { command: `node --test ".claude/hooks/*.test.mjs"` }],
    ["an rspec glob", "Bash", { command: "bin/rspec spec/requests/*_spec.rb" }],
    ["a markdown glob", "Bash", { command: "wc -l docs/spec/*.md" }],
    ["a bare * glob (known gap)", "Bash", { command: "ls config/*" }],
    ["clearing tmp", "Bash", { command: "rm -rf api/tmp/cache/*" }],
    ["a bare .* glob (known gap)", "Bash", { command: "ls -d api/.*" }],
    ["a regex in grep", "Bash", { command: `git log --oneline | grep -E "^(feat|fix).*"` }],
    ["awk braces", "Bash", { command: `docker ps | awk '{print $1}'` }],
    // credentials in app code are written with Edit/Write, which only checks paths
    ["Edit app code that reads credentials", "Edit", { file_path: "api/config/initializers/sentry.rb", new_string: "Rails.application.credentials.dig(:sentry, :dsn)" }],
    // ordinary env vars
    ["a non-secret env var", "Bash", { command: "echo $RAILS_ENV $HOME" }],
    ["setting APP_VERSION", "Bash", { command: "APP_VERSION=0.1.0 bin/rspec" }],
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
