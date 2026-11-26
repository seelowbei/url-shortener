// AWS network + EC2 VM and the Cloudflare DNS records for one environment.
// Spec: docs/spec/infrastructure.md#infrastructure-pulumi. Stacks: staging, prod.
import * as fs from "node:fs";
import * as path from "node:path";
import * as aws from "@pulumi/aws";
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const stack = pulumi.getStack();
const prefix = `url-shortener-${stack}`;

const config = new pulumi.Config();
const instanceType = config.require("instanceType");
const volumeSizeGb = config.requireNumber("volumeSizeGb");
const availabilityZoneIndex = config.getNumber("availabilityZoneIndex") ?? 0;
// prod: a fixed Elastic IP. staging: the instance's own public IP, which changes on every start.
const elasticIp = config.getBoolean("elasticIp") ?? false;
// staging only: false stops the VM (you pay for its disk only) and removes the short-host record.
// STAGING_RUNNING=true|false overrides the committed value, so `pnpm staging:start` / `staging:stop`
// switch it without editing Pulumi.staging.yaml. The committed value stays "false".
const running = runningFlag();
function runningFlag(): boolean {
  const override =
    stack === "staging" ? process.env.STAGING_RUNNING : undefined;
  if (override === undefined || override === "") {
    return config.getBoolean("running") ?? true;
  }
  if (override !== "true" && override !== "false") {
    throw new Error(
      `STAGING_RUNNING must be "true" or "false", got "${override}"`,
    );
  }
  return override === "true";
}
const sshPublicKey = config.require("sshPublicKey").trim();
const tailscaleAuthKey = config.requireSecret("tailscaleAuthKey");
const cloudflareZoneId = config.require("cloudflareZoneId");
const shortHost = config.require("shortHost");
const appHost = config.require("appHost");
const vercelCname = config.require("vercelCname");

if (elasticIp && !running) {
  throw new Error(
    "running=false is for staging only; a stack with an Elastic IP stays running",
  );
}

const tags = { Name: prefix, Project: "url-shortener", Stack: stack };
const anywhere = "0.0.0.0/0";

// --- Network: one VPC per stack, a single public subnet ---

const availabilityZone = aws
  .getAvailabilityZonesOutput({ state: "available" })
  .apply(({ names }) => {
    const name = [...names].sort()[availabilityZoneIndex];
    if (!name) {
      throw new Error(
        `availabilityZoneIndex ${availabilityZoneIndex} is out of range; this region has ${names.length} AZ(s)`,
      );
    }
    return name;
  });

const vpc = new aws.ec2.Vpc(prefix, {
  cidrBlock: "10.0.0.0/16",
  enableDnsSupport: true,
  enableDnsHostnames: true,
  tags,
});

const internetGateway = new aws.ec2.InternetGateway(prefix, {
  vpcId: vpc.id,
  tags,
});

const routeTable = new aws.ec2.RouteTable(prefix, {
  vpcId: vpc.id,
  routes: [{ cidrBlock: anywhere, gatewayId: internetGateway.id }],
  tags,
});

const subnet = new aws.ec2.Subnet(prefix, {
  vpcId: vpc.id,
  cidrBlock: "10.0.1.0/24",
  availabilityZone,
  mapPublicIpOnLaunch: true,
  tags,
});

new aws.ec2.RouteTableAssociation(prefix, {
  subnetId: subnet.id,
  routeTableId: routeTable.id,
});

// 80/443 only. SSH goes over Tailscale; emergency access is SSM Session Manager.
const securityGroup = new aws.ec2.SecurityGroup(prefix, {
  vpcId: vpc.id,
  description: "HTTP and HTTPS only; SSH is over Tailscale",
  ingress: [80, 443].map((port) => ({
    protocol: "tcp",
    fromPort: port,
    toPort: port,
    cidrBlocks: [anywhere],
  })),
  egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: [anywhere] }],
  tags,
});

// --- Instance role: SSM Session Manager for emergency shell access (no open port) ---

const role = new aws.iam.Role(prefix, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "ec2.amazonaws.com",
  }),
  tags,
});

new aws.iam.RolePolicyAttachment(`${prefix}-ssm`, {
  role: role.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
});

const instanceProfile = new aws.iam.InstanceProfile(prefix, {
  role: role.name,
  tags,
});

// --- VM ---

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
    return cloudInitTemplate.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      const value = values[key];
      if (value === undefined)
        throw new Error(`cloud-init.yaml: unknown placeholder ${match}`);
      return value;
    });
  }),
);

// Latest Canonical Ubuntu 24.04 arm64 image, from Canonical's public SSM parameter. The provider
// needs a real ami-… ID (it calls DescribeImages), so EC2's "resolve:ssm:" shortcut doesn't work.
const ubuntuAmi = aws.ssm.getParameterOutput({
  name: "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id",
}).insecureValue;

const instance = new aws.ec2.Instance(
  prefix,
  {
    ami: ubuntuAmi,
    instanceType,
    subnetId: subnet.id,
    vpcSecurityGroupIds: [securityGroup.id],
    associatePublicIpAddress: true,
    iamInstanceProfile: instanceProfile.name,
    userData,
    rootBlockDevice: {
      volumeSize: volumeSizeGb,
      volumeType: "gp3",
      encrypted: true,
      deleteOnTermination: true,
    },
    metadataOptions: {
      httpEndpoint: "enabled",
      httpTokens: "required", // IMDSv2 only
      httpPutResponseHopLimit: 2, // reachable from containers (backup accessory)
    },
    // T4g defaults to "unlimited", which bills for CPU bursts beyond the earned credits.
    creditSpecification: { cpuCredits: "standard" },
    tags,
  },
  // A newer Ubuntu image must not replace the VM (replace it on purpose with `pulumi up --replace`),
  // and cloud-init only runs on first boot, so a user_data change (e.g. a new one-time Tailscale
  // key) would just stop/start the VM for nothing.
  { ignoreChanges: ["ami", "userData"] },
);

let publicIp: pulumi.Output<string>;
if (elasticIp) {
  const eip = new aws.ec2.Eip(prefix, {
    domain: "vpc",
    instance: instance.id,
    tags,
  });
  publicIp = eip.publicIp;
} else {
  const state = new aws.ec2transitgateway.InstanceState(prefix, {
    instanceId: instance.id,
    state: running ? "running" : "stopped",
  });
  // Re-read after the start/stop, because the public IP changes on every start.
  publicIp = aws.ec2.getInstanceOutput(
    { instanceId: instance.id },
    { dependsOn: [state] },
  ).publicIp;
}

// --- DNS (Cloudflare). DNS only, never proxied: kamal-proxy does its own Let's Encrypt. ---

const recordComment = `Managed by Pulumi (${pulumi.getProject()}/${stack})`;

if (running) {
  new cloudflare.DnsRecord(`${prefix}-short`, {
    zoneId: cloudflareZoneId,
    name: shortHost,
    type: "A",
    content: publicIp,
    ttl: 60,
    proxied: false,
    comment: recordComment,
  });
}

new cloudflare.DnsRecord(`${prefix}-app`, {
  zoneId: cloudflareZoneId,
  name: appHost,
  type: "CNAME",
  content: vercelCname,
  ttl: 1,
  proxied: false,
  comment: recordComment,
});

export { publicIp, shortHost };
export const instanceId = instance.id;
export const tailscaleHost = prefix;
