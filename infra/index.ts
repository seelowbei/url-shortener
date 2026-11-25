// Oracle Cloud network + A1 VM and the Cloudflare DNS records for one environment.
// Spec: docs/spec/infrastructure.md#infrastructure-pulumi. Stacks: staging, prod.
import * as fs from "node:fs";
import * as path from "node:path";
import * as cloudflare from "@pulumi/cloudflare";
import * as oci from "@pulumi/oci";
import * as pulumi from "@pulumi/pulumi";

const stack = pulumi.getStack();
const prefix = `url-shortener-${stack}`;

const config = new pulumi.Config();
const tenancyOcid = new pulumi.Config("oci").require("tenancyOcid");
const ocpus = config.requireNumber("ocpus");
const memoryInGbs = config.requireNumber("memoryInGbs");
const availabilityDomainIndex =
  config.getNumber("availabilityDomainIndex") ?? 0;
const sshPublicKey = config.require("sshPublicKey").trim();
const sshAllowCidr = config.get("sshAllowCidr") ?? "";
const tailscaleAuthKey = config.requireSecret("tailscaleAuthKey");
const cloudflareZoneId = config.require("cloudflareZoneId");
const shortHost = config.require("shortHost");
const appHost = config.require("appHost");
const vercelCname = config.require("vercelCname");

const vcnCidr = "10.0.0.0/16";
const anywhere = "0.0.0.0/0";

// Everything for this environment lives in its own compartment under the tenancy root.
const compartment = new oci.identity.Compartment(prefix, {
  compartmentId: tenancyOcid,
  name: prefix,
  description: `URL shortener (${stack})`,
  enableDelete: true,
});
const compartmentId = compartment.id;

// --- Network ---

const vcn = new oci.core.Vcn(prefix, {
  compartmentId,
  cidrBlocks: [vcnCidr],
  displayName: prefix,
});

const internetGateway = new oci.core.InternetGateway(prefix, {
  compartmentId,
  vcnId: vcn.id,
  enabled: true,
  displayName: prefix,
});

const routeTable = new oci.core.RouteTable(prefix, {
  compartmentId,
  vcnId: vcn.id,
  displayName: prefix,
  routeRules: [
    {
      destination: anywhere,
      destinationType: "CIDR_BLOCK",
      networkEntityId: internetGateway.id,
    },
  ],
});

const tcpIngress = (port: number, source = anywhere) => ({
  protocol: "6",
  source,
  tcpOptions: { min: port, max: port },
});

// 80/443 only. SSH goes over Tailscale; sshAllowCidr opens 22 to one address for emergencies.
const securityList = new oci.core.SecurityList(prefix, {
  compartmentId,
  vcnId: vcn.id,
  displayName: prefix,
  ingressSecurityRules: [
    tcpIngress(80),
    tcpIngress(443),
    // ICMP "fragmentation needed", so path MTU discovery works for large packets.
    { protocol: "1", source: anywhere, icmpOptions: { type: 3, code: 4 } },
    { protocol: "1", source: vcnCidr, icmpOptions: { type: 3 } },
    ...(sshAllowCidr ? [tcpIngress(22, sshAllowCidr)] : []),
  ],
  egressSecurityRules: [{ protocol: "all", destination: anywhere }],
});

const subnet = new oci.core.Subnet(prefix, {
  compartmentId,
  vcnId: vcn.id,
  cidrBlock: "10.0.1.0/24",
  displayName: prefix,
  routeTableId: routeTable.id,
  securityListIds: [securityList.id],
  prohibitPublicIpOnVnic: false,
});

// --- VM ---

const shape = "VM.Standard.A1.Flex";

const availabilityDomain = oci.identity
  .getAvailabilityDomainsOutput({ compartmentId: tenancyOcid })
  .apply(({ availabilityDomains }) => {
    // Sort by name, since the API doesn't promise an order.
    const names = availabilityDomains.map((ad) => ad.name).sort();
    const name = names[availabilityDomainIndex];
    if (!name) {
      throw new Error(
        `availabilityDomainIndex ${availabilityDomainIndex} is out of range; this region has ${names.length} AD(s)`,
      );
    }
    return name;
  });

// Latest Canonical Ubuntu 24.04 aarch64 platform image (not the Minimal variant).
const imageId = oci.core
  .getImagesOutput({
    compartmentId,
    operatingSystem: "Canonical Ubuntu",
    operatingSystemVersion: "24.04",
    shape,
    sortBy: "TIMECREATED",
    sortOrder: "DESC",
  })
  .apply(({ images }) => {
    const image = images.find((i) =>
      /^Canonical-Ubuntu-24\.04-aarch64-/.test(i.displayName),
    );
    if (!image)
      throw new Error("No Canonical Ubuntu 24.04 aarch64 image found");
    return image.id;
  });

const cloudInitTemplate = fs.readFileSync(
  path.join(__dirname, "cloud-init.yaml"),
  "utf8",
);

const userData = pulumi.secret(
  tailscaleAuthKey.apply((authKey) => {
    const values: Record<string, string> = {
      hostname: prefix,
      sshPublicKey,
      tailscaleAuthKey: authKey,
    };
    const rendered = cloudInitTemplate.replace(
      /\{\{(\w+)\}\}/g,
      (match, key: string) => {
        const value = values[key];
        if (value === undefined)
          throw new Error(`cloud-init.yaml: unknown placeholder ${match}`);
        return value;
      },
    );
    return Buffer.from(rendered).toString("base64");
  }),
);

const instance = new oci.core.Instance(
  prefix,
  {
    compartmentId,
    availabilityDomain,
    displayName: prefix,
    shape,
    shapeConfig: { ocpus, memoryInGbs },
    sourceDetails: {
      sourceType: "image",
      sourceId: imageId,
      bootVolumeSizeInGbs: "50",
    },
    createVnicDetails: {
      subnetId: subnet.id,
      assignPublicIp: "true",
      displayName: prefix,
    },
    metadata: {
      ssh_authorized_keys: sshPublicKey,
      user_data: userData,
    },
    preserveBootVolume: false,
  },
  // A newer image must not replace the VM; replace it on purpose with `pulumi up --replace`.
  { ignoreChanges: ["sourceDetails"] },
);

// --- DNS (Cloudflare). DNS only, never proxied: kamal-proxy does its own Let's Encrypt. ---

new cloudflare.DnsRecord(`${prefix}-short`, {
  zoneId: cloudflareZoneId,
  name: shortHost,
  type: "A",
  content: instance.publicIp,
  ttl: 1,
  proxied: false,
  comment: `Managed by Pulumi (${pulumi.getProject()}/${stack})`,
});

new cloudflare.DnsRecord(`${prefix}-app`, {
  zoneId: cloudflareZoneId,
  name: appHost,
  type: "CNAME",
  content: vercelCname,
  ttl: 1,
  proxied: false,
  comment: `Managed by Pulumi (${pulumi.getProject()}/${stack})`,
});

export const publicIp = instance.publicIp;
export { shortHost };
export const tailscaleHost = prefix;
