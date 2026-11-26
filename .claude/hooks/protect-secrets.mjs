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
//   *.pem                        private keys
// Committed templates stay allowed: `*.example` and `*.sample` (e.g. .env.sample).
//
// Protected in shell commands:
//   - the files above, by name or by a glob that could match them
//     (`config/*.key`, `master.*`, `.env*`, `*.pem`; a bare `*` or `.*` is allowed)
//   - commands that print decrypted secrets: rails credentials:show/edit/diff,
//     kamal secrets print, pulumi ... --show-secrets
//   - Ruby that reads decrypted credentials without naming the key file:
//     Rails.application.credentials / secret_key_base / key_generator,
//     ActiveSupport::EncryptedConfiguration / EncryptedFile
//   - expanding or printing secret env vars: $RAILS_MASTER_KEY,
//     $POSTGRES_PASSWORD, $KAMAL_REGISTRY_PASSWORD, $*_TOKEN, $*_SECRET,
//     $*_API_KEY, $*_PASSWORD, `printenv <one of those>`
//
// Codex reports edits as tool_name "apply_patch" with the whole patch under
// tool_input.command, and every shell tool as "Bash" (command may be an argv
// array). Only the patch's file headers are checked, so a doc that merely
// mentions master.key stays editable, and app code written with Edit/Write may
// use Rails.application.credentials.
//
// Best effort, not a sandbox. Known gaps: a bare `*` or `.*` glob
// (`cat config/*`, `cat api/.*`),
// running a script file that reads credentials, `env` / `printenv` with no
// arguments, and shell tricks such as eval or base64-decoded commands.

import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const SECRET_NAME = /^(?:\.env(?:\..+)?|.+\.key|.+\.pem)$/;
// In shell text: a path ending in one of the protected names, not glued to a
// preceding identifier, so `ENV.fetch` or `process.env.FOO` don't match but
// `api/.env` and `config/master.key` do.
const SECRET_IN_SHELL =
  /(?:^|[^\w.$-])((?:[\w./-]*\/)?(?:\.env(?:\.[\w.-]*)?|[\w.-]+\.key|[\w.-]+\.pem))(?=$|[^\w.-])/g;
const SECRET_VAR = String.raw`(?:RAILS_MASTER_KEY|POSTGRES_PASSWORD|KAMAL_REGISTRY_PASSWORD|\w+_(?:TOKEN|SECRET|API_KEY|PASSWORD))`;
const SECRET_COMMANDS = [
  [/\bcredentials:(?:show|edit|diff)\b/, "rails credentials:show/edit/diff"],
  [/\bkamal\b[^\n;&|]*\bsecrets\s+print\b/, "kamal secrets print"],
  [/--show-secrets\b/, "--show-secrets"],
  [/\bRails\.application\.(?:credentials|secret_key_base|key_generator)\b/, "decrypted Rails credentials"],
  [/\bsecret_key_base\b/, "secret_key_base"],
  [/\bActiveSupport::Encrypted(?:Configuration|File)\b/, "decrypted Rails credentials"],
  [new RegExp(String.raw`\$\{?${SECRET_VAR}\b`), "a secret environment variable"],
  [new RegExp(String.raw`\bprintenv\b[^\n;&|]*\b${SECRET_VAR}\b`), "a secret environment variable"],
];

// Names a glob is tested against: if a shell glob could expand to one of
// these, it could expand to a real secret.
const GLOB_PROBES = ["master.key", "production.key", "oci_api_key.pem", ".env", ".env.local", ".env.production"];

/** Turns a shell glob into a RegExp (`*`, `?`, `[...]`, `{a,b}`). */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end < 0) re += "\\[";
      else {
        re += `[${glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else if (ch === "{") {
      const end = glob.indexOf("}", i + 1);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${glob.slice(i + 1, end).split(",").map((p) => p.replace(/[.+^$()|\\]/g, "\\$&")).join("|")})`;
        i = end;
      }
    } else re += ch.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Returns the first glob word in `cmd` that could expand to a secret file. */
export function secretGlob(cmd) {
  for (const raw of cmd.split(/[\s;&|()<>]+/)) {
    const word = raw.replace(/['"]/g, "");
    if (!/[*?[{]/.test(word) || isTemplate(word)) continue;
    const name = word.slice(word.lastIndexOf("/") + 1);
    // A bare `*` or `.*` is too broad to block: `rm -rf tmp/*` and grep regexes
    // like "feat.*" would trip it. Documented as a known gap above.
    if (name === "" || /^[.*]+$/.test(name)) continue;
    let re;
    try {
      re = globToRegExp(name);
    } catch {
      continue;
    }
    if (GLOB_PROBES.some((probe) => re.test(probe))) return word;
  }
  return null;
}

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
      return secretGlob(cmd);
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
