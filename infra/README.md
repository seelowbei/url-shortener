# infra

Pulumi (TypeScript) program for the AWS network + EC2 VM and the Cloudflare DNS records of one environment. Design: [docs/spec/infrastructure.md](../docs/spec/infrastructure.md#infrastructure-pulumi).

Stacks: `staging` (live) and `prod` (coming in build step 2.1). State is in Pulumi Cloud. `pulumi up` runs only from a laptop; CI only type-checks this folder.

```bash
pnpm install
pnpm typecheck                                  # tsc --noEmit
pnpm format:check                               # Prettier
pnpm staging:start                              # start staging, wait for /up, deploy latest main
pnpm staging:stop                               # stop staging
STAGING_RUNNING=true pulumi preview -s staging  # preview while staging is running
```

`Pulumi.staging.yaml` commits `running: "false"`, so a plain `pulumi preview` / `pulumi up -s staging` plans a stop. `STAGING_RUNNING=true|false` overrides it (staging stack only); the pnpm scripts set it for you.

## Config

AWS credentials come from an AWS CLI profile on your laptop (`aws configure sso`), never from the Pulumi config. Values are committed in `Pulumi.<stack>.yaml`, secrets only as `secure:` ciphertext. For a new stack, set these (`-s <stack>`):

```bash
pulumi config set aws:profile <your-aws-cli-profile>
pulumi config set --secret cloudflare:apiToken <token>
pulumi config set sshPublicKey "$(cat ~/.ssh/url-shortener-deploy.pub)"
pulumi config set --secret tailscaleAuthKey <tskey-auth-...>
```

The Tailscale auth key must be single-use, pre-approved, tagged `tag:server` and expire in 1 day. Like the rest of `cloud-init.yaml`, it's only read on the VM's first boot. Changes to `user_data` are ignored afterwards, so a new key or cloud-init edit only applies to a rebuilt VM.

## Operations

- **Start staging:** `pnpm staging:start`. It runs `pulumi up` with `STAGING_RUNNING=true` (new public IP; `go-staging` is pointed at it), waits up to 5 minutes for `/up`, then runs `pipeline.yml` on `main` to deploy what was merged while it was stopped. **Stop it** (only its disk is billed): `pnpm staging:stop`.
- **Insufficient capacity** in an AZ: `pulumi config set availabilityZoneIndex 1 && pulumi up`. This moves the subnet, so the VM is replaced.
- **Emergency shell** without Tailscale: `aws ssm start-session --target "$(pulumi stack output instanceId)"` (needs the Session Manager plugin for the AWS CLI).
- **Rebuild the VM:** `pulumi up --replace <instance-urn>`, with a fresh `tailscaleAuthKey` set first. A newer Ubuntu image never replaces it on its own.
