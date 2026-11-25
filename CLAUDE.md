@AGENTS.md

## Claude Code notes

- Read only the `docs/spec/*.md` file (and section) the task needs, not the whole spec.
- `.claude/settings.json` denies deploys, infrastructure changes and secrets, and its hooks block pushes to `main` and secret access. Don't work around them; ask the user to run those commands.
- For Rails 8.1, Kamal 2, Next.js, Pulumi OCI and PostHog API details, check current docs rather than memory.
