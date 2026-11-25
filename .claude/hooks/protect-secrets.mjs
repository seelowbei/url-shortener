#!/usr/bin/env node
// PreToolUse hook: deny agent access to secrets.
// Shared by Claude Code (.claude/settings.json) and Codex (.codex/hooks.json).
// Codex has no permission deny rules, so this hook is its only guard; for
// Claude Code it backs up the deny rules in settings.json and also covers
// Write, NotebookEdit, Grep and Bash.
//
// Protected files (by basename):
//   .env, .env.*                 local environment files
//   *.key                        config/master.key, config/credentials/*.key
//   *.pem                        private keys (e.g. the Oracle API signing key)
// Committed templates stay allowed: `*.example` and `*.sample` (e.g. .env.sample).
//
// Protected commands (they print decrypted secrets):
//   rails credentials:show, kamal secrets print, pulumi ... --show-secrets
//
// Codex reports edits as tool_name "apply_patch" with the whole patch under
// tool_input.command, and every shell tool as "Bash" (command may be an argv
// array). Only the patch's file headers are checked, so a doc that merely
// mentions master.key stays editable. Best effort: a determined shell glob can
// still slip past the Bash check.

import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const SECRET_NAME = /^(?:\.env(?:\..+)?|.+\.key|.+\.pem)$/;
// In shell text: a path ending in one of the protected names, not glued to a
// preceding identifier, so `ENV.fetch` or `process.env.FOO` don't match but
// `api/.env` and `config/master.key` do.
const SECRET_IN_SHELL =
  /(?:^|[^\w.$-])((?:[\w./-]*\/)?(?:\.env(?:\.[\w.-]*)?|[\w.-]+\.key|[\w.-]+\.pem))(?=$|[^\w.-])/g;
const SECRET_COMMANDS = [
  [/\bcredentials:show\b/, "rails credentials:show"],
  [/\bkamal\b[^\n;&|]*\bsecrets\s+print\b/, "kamal secrets print"],
  [/--show-secrets\b/, "--show-secrets"],
];

const TEMPLATE_SUFFIXES = [".example", ".sample"];
const isTemplate = (name) => TEMPLATE_SUFFIXES.some((s) => name.endsWith(s));
export const isSecretPath = (p) => {
  if (typeof p !== "string" || p === "") return false;
  const name = basename(p);
  return SECRET_NAME.test(name) && !isTemplate(name);
};

const commandText = (c) => (Array.isArray(c) ? c.join(" ") : typeof c === "string" ? c : "");

/** Returns what the tool call would expose, or null when it's fine. */
export function check(tool, input = {}) {
  switch (tool) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
      return isSecretPath(input.file_path) ? input.file_path : null;
    case "NotebookEdit":
      return isSecretPath(input.notebook_path) ? input.notebook_path : null;
    case "Grep": {
      if (isSecretPath(input.path)) return input.path;
      const glob = typeof input.glob === "string" ? input.glob : "";
      return /(?:\.env\b|\.key\b|\.pem\b)/.test(glob) && !isTemplate(glob) ? glob : null;
    }
    case "apply_patch": {
      const patch = commandText(input.command);
      for (const m of patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) {
        const target = m[1].trim();
        if (isSecretPath(target)) return target;
      }
      return null;
    }
    case "Bash": {
      const cmd = commandText(input.command);
      for (const [pattern, label] of SECRET_COMMANDS) if (pattern.test(cmd)) return label;
      for (const m of cmd.matchAll(SECRET_IN_SHELL)) {
        if (!isTemplate(m[1])) return m[1];
      }
      return null;
    }
    default:
      return null;
  }
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
  const hit = check(payload.tool_name, payload.tool_input ?? {});
  if (!hit) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Blocked: ${payload.tool_name} touches a secret (${hit}). ` +
          "Agents must not read, write or print .env files, *.key / *.pem files or decrypted credentials; ask the user to do it.",
      },
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
