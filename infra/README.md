# infra

Pulumi (TypeScript) program for the Oracle Cloud network + A1 VM and the Cloudflare DNS records of one environment. Design: [docs/spec/infrastructure.md](../docs/spec/infrastructure.md#infrastructure-pulumi).

Stacks: `staging` and `prod` (build step 2.1). State is in Pulumi Cloud. `pulumi up` runs only from a laptop; CI only type-checks this folder.

```bash
pnpm install
pnpm typecheck       # tsc --noEmit
pnpm format:check    # Prettier
pulumi preview -s staging
pulumi up -s staging
```

## Config

Non-secret values are committed in `Pulumi.<stack>.yaml`. Set the rest per stack (`-s staging`):

```bash
pulumi config set oci:tenancyOcid <ocid>
pulumi config set oci:userOcid <ocid>
pulumi config set oci:fingerprint <fingerprint>
pulumi config set oci:region <region>
pulumi config set --secret oci:privateKey < ~/.oci/oci_api_key.pem
pulumi config set --secret cloudflare:apiToken <token>
pulumi config set sshPublicKey "$(cat ~/.ssh/url-shortener-deploy.pub)"
pulumi config set --secret tailscaleAuthKey <tskey-auth-...>
```

The Tailscale auth key must be single-use, pre-approved, tagged `tag:server` and expire in 1 day. Like the rest of `cloud-init.yaml`, it only takes effect when the VM is created. Changing either one changes `user_data`, so check `pulumi preview` for a VM replacement before applying.

## Operations

- **Out of capacity:** `pulumi config set availabilityDomainIndex 1 && pulumi up`.
- **Emergency SSH** without Tailscale: `pulumi config set sshAllowCidr <your-ip>/32 && pulumi up`, then `pulumi config rm sshAllowCidr && pulumi up` when done.
- **Rebuild the VM:** `pulumi up --replace <instance-urn>` (with a fresh `tailscaleAuthKey`). A newer Ubuntu image never replaces it on its own.
