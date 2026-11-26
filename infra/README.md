# infra

Pulumi (TypeScript) program for the AWS network + EC2 VM and the Cloudflare DNS records of one environment. Design: [docs/spec/infrastructure.md](../docs/spec/infrastructure.md#infrastructure-pulumi).

Stacks: `staging` and `prod` (build step 2.1). State is in Pulumi Cloud. `pulumi up` runs only from a laptop; CI only type-checks this folder.

```bash
pnpm install
pnpm typecheck       # tsc --noEmit
pnpm format:check    # Prettier
pulumi preview -s staging
pulumi up -s staging
```

## Config

AWS credentials come from an AWS CLI profile on your laptop (`aws configure sso`), never from the Pulumi config. Non-secret values are committed in `Pulumi.<stack>.yaml`. Set the rest per stack (`-s staging`):

```bash
pulumi config set aws:profile <your-aws-cli-profile>
pulumi config set --secret cloudflare:apiToken <token>
pulumi config set sshPublicKey "$(cat ~/.ssh/url-shortener-deploy.pub)"
pulumi config set --secret tailscaleAuthKey <tskey-auth-...>
```

The Tailscale auth key must be single-use, pre-approved, tagged `tag:server` and expire in 1 day. Like the rest of `cloud-init.yaml`, it's only read on the VM's first boot. Changes to `user_data` are ignored afterwards, so a new key or cloud-init edit only applies to a rebuilt VM.

## Operations

- **Stop staging** (only its disk is billed): `pulumi config set running false && pulumi up`. **Start it:** `pulumi config set running true && pulumi up`. The start gets a new public IP, and the same `pulumi up` points `go-staging` at it.
- **Insufficient capacity** in an AZ: `pulumi config set availabilityZoneIndex 1 && pulumi up`. This moves the subnet, so the VM is replaced.
- **Emergency shell** without Tailscale: `aws ssm start-session --target "$(pulumi stack output instanceId)"` (needs the Session Manager plugin for the AWS CLI).
- **Rebuild the VM:** `pulumi up --replace <instance-urn>`, with a fresh `tailscaleAuthKey` set first. A newer Ubuntu image never replaces it on its own.
