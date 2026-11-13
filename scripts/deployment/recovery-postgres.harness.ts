import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { ERROR_IDS } from "@/constants/errorIds";
import { applyCoreMigrations } from "@/db/migrate";
import * as schema from "@/db/schema";
import { decryptToken, encryptToken } from "@/features/email/crypto";
import {
  admitNewsletterReceipt,
  finishNewsletterReceipt,
  newsletterIntent,
  readNewsletterReceipt,
} from "@/features/newsletter/operationReceipts";
import type { PermSetUser } from "@/features/permissions/effective";

const [mode, markerPath] = process.argv.slice(2);
const { DATABASE_URL: connectionString, RECOVERY_FIXTURE_RUNTIME_PASSWORD: runtimePassword } =
  process.env;
assert(mode === "seed" || mode === "verify" || mode === "reject-key");
assert(connectionString !== undefined && markerPath !== undefined);
const url = new URL(connectionString);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/recovery_fixture");
assert.equal(url.username, mode === "seed" ? "recovery_owner" : "recovery_runtime");
assert.equal(url.search, "");
assert.equal(url.hash, "");
assert.equal(process.env.NODE_ENV, "test");
const siloPort = process.env.RECOVERY_FIXTURE_SILO_PORT;
const silo = siloPort === undefined ? null : admitSilo(siloPort);

function admitSilo(port: string) {
  assert.match(port, /^[1-9][0-9]{0,4}$/u);
  assert(Number(port) <= 65_535);
  const origin = `http://127.0.0.1:${port}`;
  assert(process.env.MINIO_ENDPOINT === origin);
  assert(process.env.MINIO_BUCKET === "warpdrive-recovery-fixture");
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  assert(typeof accessKey === "string" && /^recoveryfixture[a-f0-9]{24}$/u.test(accessKey));
  assert(typeof secretKey === "string" && /^[a-f0-9]{48}$/u.test(secretKey));
  return { origin, port: Number(port), bucket: process.env.MINIO_BUCKET, accessKey, secretKey };
}

const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
  nonce: string;
  ownerId: string;
  otherOwnerId: string;
  operationId: string;
  token: string;
};
const receiptKey = { actorId: marker.ownerId, operationId: marker.operationId };
const intent = newsletterIntent(receiptKey, "campaigns.create", { name: "Recovered fixture" });
const queueName = "recovery.fixture";
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 2_000 });
const db = drizzle(pool, { schema });
const boss = new PgBoss({
  connectionString,
  max: 1,
  migrate: false,
  createSchema: false,
  schedule: false,
  supervise: false,
  reindex: false,
  registerInstance: false,
});
let queueError = false;
boss.on("error", () => {
  queueError = true;
});

const fixtureFilename = "recovery-attachment.txt";
const fixtureContentType = "text/plain";
function attachmentBytes() {
  return Buffer.from(`Owned Warpdrive recovery attachment ${marker.nonce}\n`);
}

function actor(id: string): PermSetUser {
  return { id, type: "regular", isActive: true, groupIds: new Set(), flags: new Set() };
}

async function seedAttachment(storageConfig: NonNullable<typeof silo>, mailboxId: string) {
  const { Client } = await import("minio");
  // This fixture uses disposable Silo root credentials for bootstrap and S3
  // signing. PostgreSQL readback uses its separate restricted runtime role.
  const { port, bucket, accessKey, secretKey } = storageConfig;
  const admin = new Client({ endPoint: "127.0.0.1", useSSL: false, port, accessKey, secretKey });
  assert.equal(await admin.bucketExists(bucket), false);
  await admin.makeBucket(bucket, "us-east-1");
  const { requestUpload, confirmUpload } = await import("@/features/files/actions");
  const { makeStorageClient } = await import("@/features/files/storage");
  const storage = makeStorageClient();
  const owner = actor(marker.ownerId);
  const signal = AbortSignal.timeout(10_000);
  const bytes = attachmentBytes();
  const upload = await requestUpload(
    db,
    {
      actor: owner,
      storage,
      input: {
        entityType: "email_mailbox",
        entityId: mailboxId,
        filename: fixtureFilename,
        contentType: fixtureContentType,
        size: bytes.length,
      },
    },
    signal,
  );
  assert(upload.ok, "Owned attachment upload admission failed");
  const { fileId } = upload.value;
  const [row] = await db.select().from(schema.files).where(eq(schema.files.id, fileId));
  assert(row?.status === "uploading" && row.entityId === mailboxId);
  assert(
    (await storage.putObjectBytes(row.s3Key, bytes, fixtureContentType, signal)).ok,
    "Owned attachment storage write failed",
  );
  assert(
    (await confirmUpload(db, { actor: owner, storage, fileId }, signal)).ok,
    "Owned attachment confirmation failed",
  );
  return fileId;
}

async function verifyAttachment(storageConfig: NonNullable<typeof silo>, fileId: string) {
  assert.match(fileId, /^[a-f0-9-]{36}$/u);
  const { requestDownload } = await import("@/features/files/actions");
  const { makeStorageClient } = await import("@/features/files/storage");
  const storage = makeStorageClient();
  const signal = AbortSignal.timeout(10_000);
  const [row] = await db.select().from(schema.files).where(eq(schema.files.id, fileId));
  const bytes = attachmentBytes();
  assert(
    row?.status === "ready" &&
      row.uploadedBy === marker.ownerId &&
      row.etag !== null &&
      row.etag.length > 0,
  );
  assert(row.filename === fixtureFilename && row.contentType === fixtureContentType);
  assert.equal(row.sizeBytes, bytes.length);
  const head = await storage.headObject(row.s3Key, signal);
  assert(
    head.ok &&
      head.value.etag === row.etag &&
      head.value.size === bytes.length &&
      head.value.contentType === fixtureContentType,
    "Restored attachment metadata differs",
  );
  const refused = await requestDownload(
    db,
    { actor: actor(marker.otherOwnerId), storage, fileId },
    signal,
  );
  assert(!refused.ok && refused.error.id === ERROR_IDS.PERM_DENIED);
  const permitted = await requestDownload(
    db,
    { actor: actor(marker.ownerId), storage, fileId },
    signal,
  );
  assert(permitted.ok, "Restored attachment download was refused");
  const signed = new URL(permitted.value.url);
  assert(
    signed.origin === storageConfig.origin && !signed.username && !signed.password && !signed.hash,
  );
  assert(signed.pathname === `/${storageConfig.bucket}/${row.s3Key}`);
  assert(signed.searchParams.has("X-Amz-Signature"));
  const response = await fetch(signed, { signal, redirect: "error" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.equal(downloaded.length, bytes.length);
  assert(
    createHash("sha256").update(downloaded).digest("hex") ===
      createHash("sha256").update(bytes).digest("hex"),
    "Restored attachment digest differs",
  );
  const anonymous = await fetch(new URL(signed.pathname, storageConfig.origin), {
    signal,
    redirect: "error",
  });
  assert.equal(anonymous.status, 403);
  await anonymous.body?.cancel();
  return {
    objectBytesAndMetadataVerified: true,
    anonymousObjectDenied: true,
    crossActorAttachmentDenied: true,
  };
}

try {
  const { rows } = await pool.query<{ nonce: string }>(
    "SELECT current_setting('warpdrive.recovery_fixture', true) AS nonce",
  );
  assert.match(marker.nonce, /^[a-f0-9]{32}$/u);
  assert.equal(rows[0]?.nonce, marker.nonce);
  if (mode === "seed") {
    assert(runtimePassword !== undefined && /^[a-f0-9]{64}$/u.test(runtimePassword));
    assert((await applyCoreMigrations(db, connectionString, AbortSignal.timeout(45_000))).ok);
    await pool.query(`
      CREATE ROLE recovery_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
        NOBYPASSRLS NOINHERIT PASSWORD '${runtimePassword}';
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public, pgboss TO recovery_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, pgboss TO recovery_runtime;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, pgboss TO recovery_runtime;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO recovery_runtime;
    `);
    await db.insert(schema.users).values({
      id: marker.ownerId,
      email: "owned@example.test",
      name: "Recovery fixture",
    });
    if (silo !== null) {
      await db.insert(schema.users).values({
        id: marker.otherOwnerId,
        email: "other-owned@example.test",
        name: "Recovery fixture second actor",
      });
    }
    const [mailbox] = await db
      .insert(schema.emailAccounts)
      .values({
        userId: marker.ownerId,
        emailAddress: "owned@example.test",
        refreshTokenEnc: encryptToken(marker.token),
      })
      .returning({ id: schema.emailAccounts.id });
    assert(mailbox);
    assert((await admitNewsletterReceipt(db, intent)).admitted);
    await finishNewsletterReceipt(db, receiptKey, { state: "unknown", result: null });
    await boss.start();
    await boss.createQueue(queueName);
    const jobId = await boss.send(queueName, { recoveryFixture: true }, { retryLimit: 0 });
    assert(jobId !== null);
    assert.equal((await boss.findJobs(queueName, { id: jobId }))[0]?.state, "created");
    const fileId = silo === null ? undefined : await seedAttachment(silo, mailbox.id);
    if (silo !== null && fileId !== undefined) await verifyAttachment(silo, fileId);
    process.stdout.write(`${JSON.stringify({ jobId, fileId })}\n`);
  } else {
    const [mailbox] = await db
      .select({ token: schema.emailAccounts.refreshTokenEnc })
      .from(schema.emailAccounts)
      .where(eq(schema.emailAccounts.userId, marker.ownerId));
    assert(mailbox?.token);
    const token = decryptToken(mailbox.token);
    if (mode === "reject-key") {
      assert.equal(token.ok, false);
      process.stdout.write(`${JSON.stringify({ wrongKeyRejected: true })}\n`);
    } else {
      assert(token.ok && token.value === marker.token);
      const receipt = await readNewsletterReceipt(db, receiptKey);
      assert(
        receipt?.state === "unknown" && receipt.reviewAvailable && receipt.resolution === null,
      );
      assert.equal(
        await readNewsletterReceipt(db, { ...receiptKey, actorId: marker.otherOwnerId }),
        null,
      );
      assert.deepEqual(await admitNewsletterReceipt(db, intent), {
        admitted: false,
        state: "unknown",
        result: null,
      });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assert.rejects(client.query("CREATE TABLE public.recovery_forbidden(id integer)"), {
          code: "42501",
        });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      const jobId = process.env.RECOVERY_FIXTURE_JOB_ID;
      assert(jobId !== undefined);
      await boss.start();
      const [job] = await boss.findJobs(queueName, { id: jobId });
      assert(job?.state === "created");
      assert.deepEqual(job.data, { recoveryFixture: true });
      assert.equal(queueError, false);
      const facts = {
        credentialDecrypted: true,
        queuePending: true,
        unknownReceiptHeld: true,
        crossActorReceiptHidden: true,
        runtimeDdlDenied: true,
      };
      const fileId = process.env.RECOVERY_FIXTURE_FILE_ID;
      assert((silo === null) === (fileId === undefined));
      const objects =
        silo !== null && fileId !== undefined ? await verifyAttachment(silo, fileId) : {};
      process.stdout.write(`${JSON.stringify({ ...facts, ...objects })}\n`);
    }
  }
} finally {
  try {
    await boss.stop({ graceful: false, timeout: 1_000 });
  } finally {
    await pool.end();
  }
}
