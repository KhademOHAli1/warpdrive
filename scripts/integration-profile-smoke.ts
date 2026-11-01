import { randomUUID } from "node:crypto";
import { Agent } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { Client } from "minio";
import { PgBoss } from "pg-boss";
import { WebSocket } from "ws";
import { z } from "zod";
import { env } from "@/config/env";
import { db, pool } from "@/db/client";
import { authUsers, sessions, users, wsTickets } from "@/db/schema";
import { sessionFixture } from "@/features/auth/session.test-helpers";
import { mintTicket } from "@/server/ws/ticket";
import { err, ok, type Result } from "@/types/result";

// This operational harness may only mutate the programme's disposable local profile.
const DEADLINE_MS = 8_000;
const QUEUE = "auth-maintenance";
const checks: string[] = [];
const sockets: WebSocket[] = [];
const agent = new Agent({ keepAlive: false, timeout: DEADLINE_MS });
const userId = randomUUID();
const objectKey = `base-smoke/${userId}.txt`;
let boss: PgBoss | undefined;
let storage: Client | undefined;
let fixtureStarted = false;
let objectStarted = false;

function requireCheck(value: boolean, code: string): asserts value {
  if (!value) throw new Error(code);
}

function profileCheck(): Result<void, string> {
  const pg = new URL(env.DATABASE_URL);
  const exact =
    env.BASE_URL === "http://127.0.0.1:3160" &&
    pg.hostname === "127.0.0.1" &&
    pg.port === "55436" &&
    pg.pathname === "/integration_program_preview" &&
    decodeURIComponent(pg.username) === "integration_program" &&
    pg.search === "" &&
    env.WS_PUBLIC_URL === "ws://127.0.0.1:8080" &&
    env.WS_HOST === "127.0.0.1" &&
    env.MINIO_ENDPOINT === "http://127.0.0.1:9160" &&
    env.MINIO_BUCKET === "integration-program" &&
    env.NODE_ENV === "development" &&
    env.DISABLE_UPDATE_CHECK &&
    env.DISABLE_TELEMETRY &&
    env.GOOGLE_OAUTH_CLIENT_ID === "" &&
    env.SLACK_CLIENT_ID === "";
  return exact ? ok(undefined) : err("profile_refused_before_writes");
}

async function bounded<T>(operation: Promise<T>, code: string, ms = DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function connect(): Promise<WebSocket> {
  const socket = new WebSocket(env.WS_PUBLIC_URL, { origin: env.BASE_URL });
  sockets.push(socket);
  socket.on("error", () => undefined);
  await bounded(
    new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", () => reject(new Error("ws_connect_failed")));
    }),
    "ws_connect_deadline",
  );
  return socket;
}

async function frame(socket: WebSocket, kind: string): Promise<Record<string, unknown>> {
  let onMessage: ((raw: Buffer) => void) | undefined;
  try {
    return await bounded(
      new Promise<Record<string, unknown>>((resolve, reject) => {
        onMessage = (raw: Buffer) => {
          try {
            const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(raw.toString()));
            if (parsed.success && parsed.data.kind === kind) resolve(parsed.data);
          } catch {
            reject(new Error("ws_malformed_frame"));
          }
        };
        socket.on("message", onMessage);
      }),
      `ws_${kind}_deadline`,
    );
  } finally {
    if (onMessage !== undefined) socket.off("message", onMessage);
  }
}

async function exchange(socket: WebSocket, data: object, kind: string) {
  const response = frame(socket, kind);
  socket.send(JSON.stringify(data));
  return response;
}

async function rejectedTicket(socket: WebSocket, ticket: string): Promise<void> {
  const closed = bounded(
    new Promise<number>((resolve) => socket.once("close", (code) => resolve(code))),
    "ws_reject_deadline",
  );
  socket.send(JSON.stringify({ kind: "auth", ticket }));
  requireCheck((await closed) === 4401, "ws_rejection_code");
}

async function workerSmoke(): Promise<void> {
  boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    application_name: "integration-profile-smoke-producer",
    connectionTimeoutMillis: 5_000,
    options: "-c statement_timeout=5000",
    migrate: false,
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => undefined);
  await bounded(boss.start(), "boss_start_deadline");
  requireCheck((await boss.getQueue(QUEUE)) !== null, "worker_queue_not_registered");
  const jobId = await boss.send(QUEUE, { smokeId: userId }, { retryLimit: 0 });
  requireCheck(jobId !== null, "worker_job_not_enqueued");
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const job = await boss.getJobById(QUEUE, jobId);
    if (job?.state === "completed") {
      requireCheck(
        Number.isFinite(job.startedOn.getTime()) && job.completedOn !== null,
        "worker_missing_timestamps",
      );
      checks.push("separate-producer_registered-auth-maintenance_completed");
      return;
    }
    requireCheck(job?.state !== "failed", "worker_job_failed");
    await delay(300);
  }
  throw new Error("worker_completion_deadline");
}

async function realtimeSmoke(): Promise<void> {
  fixtureStarted = true;
  await db
    .insert(users)
    .values({ id: userId, email: `base-smoke-${userId}@example.invalid`, name: "BASE smoke" });
  await db.insert(authUsers).values({
    id: userId,
    email: `base-smoke-${userId}@example.invalid`,
    name: "BASE smoke",
    emailVerified: true,
  });
  const [session] = await db
    .insert(sessions)
    .values({
      ...sessionFixture({ userId, expiresAt: new Date(Date.now() + 300_000) }),
      authMethod: "password",
      assurance: "password",
    })
    .returning({ id: sessions.id });
  requireCheck(session !== undefined, "session_fixture_failed");
  await rejectedTicket(await connect(), "invalid-smoke-ticket");
  checks.push("realtime_invalid-auth_denied-4401");
  const ticket = await mintTicket({ userId, sessionId: session.id });
  const socket = await connect();
  await exchange(socket, { kind: "auth", ticket }, "auth_ok");
  checks.push("realtime_synthetic-native-session_authenticated");
  await rejectedTicket(await connect(), ticket);
  checks.push("realtime_ticket-replay_denied-4401");
  const ownChannel = `user:${userId}`;
  const subscribed = await exchange(
    socket,
    { kind: "subscribe", channel: ownChannel },
    "subscribed",
  );
  requireCheck(subscribed.channel === ownChannel, "own_subscription_failed");
  const otherChannel = `user:${randomUUID()}`;
  const denied = await exchange(socket, { kind: "subscribe", channel: otherChannel }, "error");
  requireCheck(denied.channel === otherChannel, "other_user_subscription_not_denied");
  checks.push("realtime_own-user_subscribed_other-user_denied");
  const event = frame(socket, "event");
  const notificationId = randomUUID();
  await db.execute(
    sql`SELECT pg_notify(${ownChannel}, ${JSON.stringify({ v: 1, channel: ownChannel, ts: new Date().toISOString(), actorId: null, type: "notification", data: { notificationId, kind: "base-smoke" } })})`,
  );
  const received = z
    .object({
      channel: z.string(),
      type: z.literal("notification"),
      seq: z.literal(0),
      data: z.object({ notificationId: z.string(), kind: z.literal("base-smoke") }),
    })
    .parse((await event).event);
  requireCheck(
    received.channel === ownChannel && received.data.notificationId === notificationId,
    "notify_relay_mismatch",
  );
  checks.push("realtime_actual-pg-notify_relayed-seq0");
}

async function storageSmoke(): Promise<void> {
  storage = new Client({
    endPoint: "127.0.0.1",
    port: 9160,
    useSSL: false,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
    transportAgent: agent,
  });
  const content = Buffer.from("BASE local storage: فارسی / Deutsch / English\n");
  objectStarted = true;
  await bounded(
    storage.putObject(env.MINIO_BUCKET, objectKey, content, content.length, {
      "Content-Type": "text/plain; charset=utf-8",
    }),
    "storage_put_deadline",
  );
  const object = await bounded(
    storage.getObject(env.MINIO_BUCKET, objectKey),
    "storage_get_deadline",
  );
  const chunks: Buffer[] = [];
  await bounded(
    new Promise<void>((resolve, reject) => {
      object.on("data", (chunk: Buffer) => chunks.push(chunk));
      object.once("end", resolve);
      object.once("error", reject);
    }),
    "storage_read_deadline",
  );
  requireCheck(Buffer.concat(chunks).equals(content), "storage_bytes_mismatch");
  await bounded(storage.removeObject(env.MINIO_BUCKET, objectKey), "storage_delete_deadline");
  const absent = await storage.statObject(env.MINIO_BUCKET, objectKey).then(
    () => false,
    (cause: unknown) =>
      z.object({ code: z.literal("NotFound") }).safeParse(cause).success ||
      z.object({ code: z.literal("NoSuchKey") }).safeParse(cause).success,
  );
  requireCheck(absent, "storage_delete_not_confirmed");
  objectStarted = false;
  checks.push("storage_actual-upload-read-delete_unicode-bytes");
}

async function cleanup(): Promise<void> {
  for (const socket of sockets) socket.terminate();
  const outcomes = await Promise.allSettled([
    (async () => {
      try {
        if (objectStarted && storage !== undefined)
          await bounded(
            storage.removeObject(env.MINIO_BUCKET, objectKey),
            "cleanup_object_deadline",
          );
      } finally {
        agent.destroy();
      }
    })(),
    (async () => {
      if (!fixtureStarted) return;
      await db.transaction(async (tx) => {
        await tx.delete(wsTickets).where(eq(wsTickets.userId, userId));
        await tx.delete(sessions).where(eq(sessions.userId, userId));
        await tx.delete(authUsers).where(eq(authUsers.id, userId));
        await tx.delete(users).where(eq(users.id, userId));
      });
      const remaining = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
      requireCheck(remaining.length === 0, "fixture_cleanup_unconfirmed");
      checks.push("synthetic-ticket-session-user_cleaned");
    })(),
    (async () => {
      if (boss !== undefined) await bounded(boss.stop({ graceful: false }), "boss_stop_deadline");
    })(),
  ]);
  const closed = await Promise.allSettled([bounded(pool.end(), "pool_stop_deadline")]);
  requireCheck(
    [...outcomes, ...closed].every((outcome) => outcome.status === "fulfilled"),
    "cleanup_incomplete",
  );
}

async function main(): Promise<Result<string[], string>> {
  const profile = profileCheck();
  if (!profile.ok) return profile;
  let step = "read-only-preflight";
  try {
    pool.options.connectionTimeoutMillis = 5_000;
    pool.options.statement_timeout = 5_000;
    pool.options.query_timeout = 5_000;
    const empty = await pool.query<{ safe: boolean }>(
      "SELECT NOT EXISTS (SELECT 1 FROM users) AND NOT EXISTS (SELECT 1 FROM auth_mail_outbox) AND NOT EXISTS (SELECT 1 FROM auth_integration_revocations) AND NOT EXISTS (SELECT 1 FROM email_accounts) AND NOT EXISTS (SELECT 1 FROM integration_connections) AS safe",
    );
    requireCheck(empty.rows[0]?.safe === true, "nonempty_profile_refused_before_writes");
    checks.push("exact-isolated-profile_empty-provider-data");
    const health = await fetch(`${env.BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(DEADLINE_MS),
      redirect: "error",
    });
    requireCheck(
      health.status === 200 &&
        z.object({ ok: z.literal(true) }).safeParse(await health.json()).success,
      "app_health_failed",
    );
    checks.push("app_database-health_200");
    step = "worker";
    await workerSmoke();
    step = "realtime";
    await realtimeSmoke();
    step = "storage";
    await storageSmoke();
    return ok(checks);
  } catch (cause) {
    const detail =
      cause instanceof Error && /^[a-z0-9_-]+$/.test(cause.message)
        ? cause.message
        : "operation_failed";
    return err(`${step}:${detail}`);
  } finally {
    await cleanup();
  }
}

// A final process bound also covers third-party SDK calls that lack cancellation.
const hardDeadline = setTimeout(() => {
  agent.destroy();
  console.error(JSON.stringify({ ok: false, error: "whole-smoke_90s_deadline", checks }));
  process.exit(1);
}, 90_000);
hardDeadline.unref();
try {
  const result = await main();
  console.warn(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
  clearTimeout(hardDeadline);
} catch {
  console.error(JSON.stringify({ ok: false, error: "smoke_cleanup_failed", checks }));
  process.exitCode = 1;
}
