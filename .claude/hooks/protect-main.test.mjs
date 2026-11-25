// node --test ".claude/hooks/*.test.mjs"   (also run in CI)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blockedPush, simpleCommands } from "./protect-main.mjs";

const onBranch = (branch, pushTarget = branch ? `origin/${branch}` : "") => () => ({ branch, pushTarget });

describe("blockedPush", () => {
  const blocked = [
    ["bare push on main", "git push", onBranch("main")],
    ["push with remote only on main", "git push -u origin", onBranch("main")],
    ["HEAD on main", "git push origin HEAD", onBranch("main")],
    ["explicit main", "git push origin main", onBranch("feature")],
    ["HEAD:main", "git push origin HEAD:main", onBranch("feature")],
    ["force refspec", "git push origin +feature:main", onBranch("feature")],
    ["full ref", "git push origin refs/heads/main", onBranch("feature")],
    ["delete main", "git push origin :main", onBranch("feature")],
    ["--all", "git push --all origin", onBranch("feature")],
    ["--mirror", "git push --mirror", onBranch("feature")],
    ["branch tracking main", "git push", onBranch("hotfix", "origin/main")],
    ["after &&", "pnpm test && git push", onBranch("main")],
    ["rtk prefix", "rtk git push origin main", onBranch("feature")],
    ["git -C", "git -C ../repo push origin main", onBranch("feature")],
    ["option before refspec", "git push --force-with-lease origin main", onBranch("feature")],
    ["push option value", "git push -o ci.skip origin main", onBranch("feature")],
    ["quoted refspec", `git push origin "HEAD:main"`, onBranch("feature")],
    ["a push after a heredoc ends", "cat <<'EOF' > notes.txt\ngit push is mentioned here\nEOF\ngit push origin main", onBranch("feature")],
    ["a push on the heredoc's own line", "git push origin main <<'EOF'\ntext\nEOF", onBranch("feature")],
    ["a push after two heredocs on one line", "cat <<A <<B\na\nA\nb\nB\ngit push origin main", onBranch("feature")],
    ["a here-string is not a heredoc", "cat <<< x && git push origin main", onBranch("feature")],
    ["a # inside a word is not a comment", "git push origin feat#1:main", onBranch("feature")],
    ["a subshell", "echo $(git push origin main)", onBranch("feature")],
  ];
  for (const [name, cmd, state] of blocked) {
    it(`blocks ${name}`, () => assert.ok(blockedPush(cmd, "/repo", state), cmd));
  }

  const allowed = [
    ["bare push on a feature branch", "git push", onBranch("feature")],
    ["feature branch with -u", "git push -u origin security/x", onBranch("security/x")],
    ["HEAD on a feature branch", "git push origin HEAD", onBranch("feature")],
    ["branch named like main", "git push origin main-redesign", onBranch("main-redesign")],
    ["fetching main", "git fetch origin main && git pull --ff-only origin main", onBranch("main")],
    ["text mentioning git push", `echo "never git push to main"`, onBranch("main")],
    ["not a push", "git log origin/main", onBranch("main")],
    ["a heredoc commit message", "git commit -q -F - <<'EOF'\nNever git push to main from a hook.\nEOF", onBranch("feature")],
    ["a heredoc PR body", "gh pr create --body-file - <<'EOF'\n- run git push origin main only via CI\nEOF", onBranch("feature")],
    ["an unquoted heredoc", "cat <<EOF\ngit push origin main\nEOF", onBranch("feature")],
    ["a <<- heredoc with tab-indented delimiter", "cat <<-END\n\tgit push origin main\n\tEND", onBranch("feature")],
    ["a comment line", "# git push origin main\necho ok", onBranch("feature")],
    ["a trailing comment", "echo ok # then git push origin main", onBranch("feature")],
  ];
  for (const [name, cmd, state] of allowed) {
    it(`allows ${name}`, () => assert.equal(blockedPush(cmd, "/repo", state), null, cmd));
  }

  it("resolves cd and -C against the hook's cwd", () => {
    const dirs = [];
    const state = (dir) => (dirs.push(dir), { branch: "main", pushTarget: "origin/main" });
    blockedPush("cd sub && git push", "/repo", state);
    blockedPush("git -C other push", "/repo", state);
    assert.deepEqual(dirs, ["/repo/sub", "/repo/other"]);
  });
});

it("simpleCommands splits on shell operators and strips quotes", () => {
  assert.deepEqual(simpleCommands(`a 'b c' && d "e\\"f"; g | h`), [["a", "b c"], ["d", 'e"f'], ["g"], ["h"]]);
});

describe("hook script", () => {
  const script = new URL("./protect-main.mjs", import.meta.url).pathname;
  const run = (command, cwd) =>
    spawnSync("node", [script], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }), encoding: "utf8" });

  it("denies a bare push from main in a real repo and allows it from a branch", () => {
    const repo = mkdtempSync(join(tmpdir(), "protect-main-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main", repo]);
      const denied = run("git push", repo);
      assert.equal(denied.status, 0);
      assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
      execFileSync("git", ["-C", repo, "switch", "-q", "-c", "feature"]);
      assert.equal(run("git push", repo).stdout, "");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("ignores other tools and bad input", () => {
    const other = spawnSync("node", [script], { input: JSON.stringify({ tool_name: "Read", tool_input: {} }), encoding: "utf8" });
    assert.equal(other.stdout, "");
    assert.equal(spawnSync("node", [script], { input: "not json", encoding: "utf8" }).stdout, "");
  });
});
