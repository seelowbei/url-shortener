#!/usr/bin/env node
// PreToolUse hook: deny agent `git push` that would update `main`.
// Shared by Claude Code (.claude/settings.json) and Codex (.codex/hooks.json).
// GitHub branch protection already rejects direct pushes to main; this hook
// stops the attempt before it runs, with a clear reason, so agents go straight
// to a feature branch and a PR (every merge to main deploys to staging).
//
// A push is blocked when it names main as a destination (`main`, `HEAD:main`,
// `refs/heads/main`, `+x:main`, `:main`), uses `--all` / `--mirror`, or has no
// refspec (or `HEAD`) while the current branch, or its push target, is main.
// A bare `git push` from main is the case pattern-based deny rules can't see.
// Best effort: it follows `cd <dir>` and `git -C <dir>` and skips heredoc bodies
// and `#` comments, but not every shell trick (git aliases, eval, scripts).

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PROTECTED = new Set(["main"]);

const commandText = (c) => (Array.isArray(c) ? c.join(" ") : typeof c === "string" ? c : "");

/**
 * Splits shell text into simple commands, each a list of unquoted words.
 * Heredoc bodies and `#` comments are data, not commands, so they are skipped:
 * a commit message or PR body that mentions pushing to main must not be blocked.
 */
export function simpleCommands(text) {
  const commands = [];
  let words = [];
  let word = "";
  let inWord = false;
  let quote = null;
  /** Heredocs opened on the current line; their bodies start after its newline. */
  let heredocs = [];
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < text.length) word += text[++i];
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === "\\" && i + 1 < text.length) {
      word += text[++i];
      inWord = true;
    } else if (ch === "#" && !inWord) {
      // Comment: skip to the end of the line (the newline itself still ends the command).
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    } else if (ch === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
      // Heredoc operator `<<DELIM`, `<<-DELIM`, `<<'DELIM'`, `<<"DELIM"`.
      endWord();
      i += 2;
      const stripTabs = text[i] === "-";
      if (stripTabs) i++;
      while (text[i] === " " || text[i] === "\t") i++;
      let delim = "";
      while (i < text.length && !/[\s;&|()<>]/.test(text[i])) {
        if (text[i] !== "'" && text[i] !== '"' && text[i] !== "\\") delim += text[i];
        i++;
      }
      i--; // the loop's i++ lands on the character after the delimiter
      if (delim) heredocs.push({ delim, stripTabs });
    } else if (ch === "\n" && heredocs.length) {
      endCommand();
      // Skip each body in order, up to and including its delimiter line.
      for (const { delim, stripTabs } of heredocs) {
        for (;;) {
          const start = i + 1;
          if (start >= text.length) break;
          const nl = text.indexOf("\n", start);
          const end = nl < 0 ? text.length : nl;
          const line = text.slice(start, end);
          i = end;
          if ((stripTabs ? line.replace(/^\t+/, "") : line) === delim) break;
        }
      }
      heredocs = [];
    } else if (ch === ";" || ch === "&" || ch === "|" || ch === "\n" || ch === "(" || ch === ")") {
      endCommand();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

const GIT_OPTS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const PUSH_OPTS_WITH_VALUE = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

/** Parses `git [opts] push [opts] [remote [refspec...]]`; null when the words aren't a push. */
export function parsePush(words) {
  const gitAt = words.findIndex((w) => w === "git" || w.endsWith("/git"));
  if (gitAt < 0) return null;
  let i = gitAt + 1;
  let dir = null;
  while (i < words.length && words[i].startsWith("-")) {
    const opt = words[i];
    if (opt === "-C") dir = words[i + 1] ?? null;
    if (GIT_OPTS_WITH_VALUE.has(opt)) i += 2;
    else i += 1;
  }
  if (words[i] !== "push") return null;
  const positional = [];
  let all = false;
  for (i += 1; i < words.length; i++) {
    const w = words[i];
    if (w === "--") {
      positional.push(...words.slice(i + 1));
      break;
    }
    if (w.startsWith("-")) {
      if (w === "--all" || w === "--mirror" || w === "--branches") all = true;
      if (PUSH_OPTS_WITH_VALUE.has(w)) i += 1;
      continue;
    }
    positional.push(w);
  }
  return { dir, remote: positional[0] ?? null, refspecs: positional.slice(1), all };
}

/** Destination branch of one refspec; "HEAD" stays "HEAD" for the caller to resolve. */
export function refspecTarget(spec) {
  const s = spec.replace(/^\+/, "");
  const dst = s.includes(":") ? s.slice(s.indexOf(":") + 1) : s;
  return dst.replace(/^refs\/heads\//, "");
}

function git(dir, args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** Current branch and where a bare `git push` would go (e.g. "origin/main"), from the repo at `dir`. */
export function repoState(dir) {
  return {
    branch: git(dir, ["symbolic-ref", "--short", "-q", "HEAD"]),
    pushTarget: git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{push}"]),
  };
}

/** Returns why a push in `commandLine` would update a protected branch, or null. */
export function blockedPush(commandLine, cwd, state = repoState) {
  let dir = cwd;
  for (const words of simpleCommands(commandLine)) {
    if (words[0] === "cd" && words[1]) {
      dir = resolve(dir, words[1]);
      continue;
    }
    const push = parsePush(words);
    if (!push) continue;
    const repoDir = push.dir ? resolve(dir, push.dir) : dir;
    if (push.all) return "pushes every branch, including main";
    const current = () => state(repoDir);
    if (push.refspecs.length === 0) {
      const { branch, pushTarget } = current();
      if (PROTECTED.has(branch)) return `the current branch is ${branch}`;
      const target = pushTarget.slice(pushTarget.indexOf("/") + 1);
      if (pushTarget && PROTECTED.has(target)) return `this branch pushes to ${target}`;
      continue;
    }
    for (const spec of push.refspecs) {
      const target = refspecTarget(spec);
      if (PROTECTED.has(target)) return `it targets ${target}`;
      if (target === "HEAD" || target === "@") {
        const { branch } = current();
        if (PROTECTED.has(branch)) return `HEAD is ${branch}`;
      }
    }
  }
  return null;
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // not our business; let other checks decide
  }
  if (payload.tool_name !== "Bash") return;
  const reason = blockedPush(commandText(payload.tool_input?.command), payload.cwd || process.cwd());
  if (!reason) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Blocked: agents must not push to main (${reason}). main is protected and every merge to it deploys to staging. ` +
          "Push a feature branch and open a PR; if the checkout is on main, create a branch first.",
      },
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
