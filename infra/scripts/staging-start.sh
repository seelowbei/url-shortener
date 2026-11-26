#!/usr/bin/env bash
# Start staging, wait until the API answers, then deploy the latest main to it.
# Yours to run from infra/ (`pnpm staging:start`): agents never apply infrastructure.
# Spec: docs/spec/infrastructure.md#aws-ec2-vm-rails
set -euo pipefail
cd "$(dirname "$0")/.."

# Starts the VM and recreates the short-host DNS record. Asks for confirmation as usual.
STAGING_RUNNING=true pulumi up -s staging

host=$(pulumi stack output shortHost -s staging)
ip=$(pulumi stack output publicIp -s staging)

# The VM boots with the containers it had, so /up answers with the last deployed commit.
# --resolve skips local DNS, which may still cache the record deleted while staging was stopped.
echo "Waiting for https://$host/up on $ip ..."
up=""
for _ in $(seq 1 60); do
  if body=$(curl -fsS --max-time 5 --resolve "$host:443:$ip" "https://$host/up" 2>/dev/null); then
    up=$body
    break
  fi
  sleep 5
done
if [ -z "$up" ]; then
  echo "Staging didn't answer within 5 minutes; not deploying. Check the VM, then run:" >&2
  echo "  gh workflow run pipeline.yml --ref main" >&2
  exit 1
fi
echo "Staging is up on the previous release: $up"

# Catch up on everything merged while staging was stopped.
gh workflow run pipeline.yml --ref main
sleep 5
echo "Pipeline: $(gh run list --workflow pipeline.yml --event workflow_dispatch --limit 1 --json url --jq '.[0].url')"
