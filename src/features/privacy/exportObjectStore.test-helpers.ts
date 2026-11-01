import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Client } from "minio";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

export const SEAWEED_IMAGE =
  "chrislusf/seaweedfs@sha256:c2658820e763294a9e9de7b36c81e59b879e3459148351aee4e31a126ca64860";

class LoopbackS3Container extends GenericContainer {
  constructor() {
    super(SEAWEED_IMAGE);
    this.withExposedPorts(8333);
    this.hostConfig.PortBindings = {
      "8333/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
    };
  }
}

export interface S3Fixture {
  container: StartedTestContainer;
  client: Client;
  config: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    requestTimeoutMs: number;
  };
}

export async function startS3Fixture(
  options: { observeLogs?: (stream: Readable) => unknown; diagnosticLogToStderr?: boolean } = {},
): Promise<S3Fixture> {
  const accessKey = `fixture-${randomUUID()}`;
  const secretKey = randomUUID();
  const auth = JSON.stringify({
    identities: [
      {
        name: "synthetic-private",
        credentials: [{ accessKey, secretKey }],
        actions: ["Admin", "Read", "Write", "List", "Tagging"],
      },
    ],
  });
  const builder = new LoopbackS3Container()
    .withEntrypoint(["weed"])
    .withCommand([
      ...(options.diagnosticLogToStderr === true ? ["-logtostderr=true"] : []),
      "mini",
      "-dir=/data",
      "-ip=127.0.0.1",
      "-ip.bind=0.0.0.0",
      "-s3.config=/tmp/s3.json",
      "-master.telemetry=false",
      "-master.volumeSizeLimitMB=64",
      "-volume.max=2",
      "-webdav=false",
      "-admin.ui=false",
      "-s3.port.iceberg=0",
      "-s3.port.lance=0",
    ])
    .withCopyContentToContainer([{ content: auth, target: "/tmp/s3.json", mode: 0o600 }])
    .withResourcesQuota({ memory: 0.5, cpu: 1 })
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(60_000);
  if (options.observeLogs !== undefined) builder.withLogConsumer(options.observeLogs);
  const container = await builder.start();
  try {
    const port = container.getMappedPort(8333);
    const client = new Client({
      endPoint: container.getHost(),
      port,
      useSSL: false,
      accessKey,
      secretKey,
      region: "us-east-1",
      retryOptions: { disableRetry: true },
    });
    const bucket = `privacy-${randomUUID()}`;
    await client.makeBucket(bucket, "us-east-1");
    await client.setBucketVersioning(bucket, { Status: "Enabled" });
    return {
      container,
      client,
      config: {
        endpoint: `http://${container.getHost()}:${port}`,
        accessKey,
        secretKey,
        bucket,
        requestTimeoutMs: 3000,
      },
    };
  } catch (cause) {
    await container.stop();
    throw cause;
  }
}

export const objectKey = (ref: { artifactId: string; attemptId: string }) =>
  `privacy-exports/v1/${ref.artifactId}/${ref.attemptId}.tar.gz`;

export async function readBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
