import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { eq, inArray, or, sql } from "drizzle-orm";
import superjson from "superjson";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import {
  authAccounts,
  authMailOutbox,
  authRateLimits,
  authSecurityEvents,
  authTwoFactors,
  authUsers,
  authVerifications,
  permissionSets,
  persons,
  sessions,
  users,
} from "@/db/schema";
import { createBetterAuth } from "@/features/auth/better/auth";
import { nativeAuthGateway } from "@/features/auth/better/nativeGateway";
import {
  hashSessionCredential,
  readCookie,
  sessionTokenFromCookie,
} from "@/features/auth/better/sessionToken";
import { readAuthPolicy } from "@/features/auth/management/policy";
import {
  admitCoreMutationEngine,
  type CoreHttpMutationFacts,
  type CoreMutationEngineFixture,
  runCoreHttpMutationChecks,
} from "./core-http-mutations.harness";
import type { AppRouter } from "./root";

interface LoopbackServer {
  readonly url: URL;
  stop(closeActiveConnections: boolean): void | Promise<void>;
}
interface BunHttpRuntime {
  serve(options: {
    hostname: "127.0.0.1";
    port: 0;
    maxRequestBodySize: number;
    fetch: (request: Request) => Promise<Response>;
  }): LoopbackServer;
}
interface IssuedSession {
  id: string;
  cookie: string;
}
type SessionName = "a" | "b" | "revoked" | "expired" | "idle" | "pending" | "mfa";
interface Fixture {
  setId: string;
  userIds: [string, string, string];
  personIds: [string, string];
  emails: [string, string, string];
  password: string;
  sessions: Partial<Record<SessionName, IssuedSession>>;
}
interface Observation {
  status: number;
  timing: string | null;
  batch: boolean;
}
interface HarnessState {
  origin: string | null;
  server: LoopbackServer | null;
  stage: string;
  seeded: boolean;
  missingCsrfFacts: boolean;
}
interface NativeResidue {
  rateLimits: number;
  securityEvents: number;
  verifications: number;
}
export interface CoreHttpHarnessReport {
  kind: "warpdrive-core-http-cookie-seam";
  success: boolean;
  checks: { name: string; passed: true }[];
  failureStage?: string;
  failureKind?: string;
  ownedHttpOrigin?: string;
  blockedFetchAttempts: number;
  unexpectedErrors: number;
  cleanupSuccess: boolean;
  databaseDropRequired: true;
  nativeResidue?: NativeResidue;
  mutations?: CoreHttpMutationFacts;
  seconds: number;
  limitations: string[];
}

class NativeCookieJar {
  private readonly values = new Map<string, string>();
  readonly origin = new URL(env.BASE_URL).origin;
  apply(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0] ?? "";
      const split = pair.indexOf("=");
      if (split < 1) continue;
      const name = pair.slice(0, split),
        value = pair.slice(split + 1);
      if (value === "") this.values.delete(name);
      else this.values.set(name, value);
    }
  }
  cookie(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  headers(): Headers {
    return new Headers({
      origin: this.origin,
      host: new URL(this.origin).host,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      cookie: this.cookie(),
    });
  }
}

function bunRuntime(): BunHttpRuntime {
  const runtime = globalThis as typeof globalThis & { Bun?: BunHttpRuntime };
  assert(runtime.Bun !== undefined, "Run this harness in its own Bun process");
  return runtime.Bun;
}

async function admitDatabase(db: Db): Promise<void> {
  assert(
    env.DISABLE_TELEMETRY && env.AUTH_ALLOW_PASSWORD,
    "Native password flow and disabled telemetry required",
  );
  const source = new URL(env.DATABASE_URL);
  assert(["postgres:", "postgresql:"].includes(source.protocol), "PostgreSQL URL required");
  assert(
    ["127.0.0.1", "localhost", "[::1]", "::1"].includes(source.hostname),
    "Database must use loopback",
  );
  const expected = decodeURIComponent(source.pathname.slice(1));
  assert(
    /^warpdrive_core_api_seam_[a-zA-Z0-9_]+$/u.test(expected),
    "Owned disposable database required",
  );
  const current = await db.execute<{ name: string }>(sql`SELECT current_database() AS name`);
  assert.equal(current.rows[0]?.name, expected, "Injected DB and runtime URL must agree");
  const policy = await readAuthPolicy(db, AbortSignal.timeout(5000));
  assert(
    !policy.requireMfaForAll,
    "Fresh database must retain the default regular-user MFA policy",
  );
}

function newFixture(): Fixture {
  const suffix = randomUUID();
  return {
    setId: suffix,
    userIds: [randomUUID(), randomUUID(), randomUUID()],
    personIds: [randomUUID(), randomUUID()],
    password: `Core-harness-${randomBytes(24).toString("base64url")}`,
    emails: [
      `core-a-${suffix}@example.test`,
      `core-b-${suffix}@example.test`,
      `core-admin-${suffix}@example.test`,
    ],
    sessions: {},
  };
}

function issued(fixture: Fixture, name: SessionName): IssuedSession {
  const session = fixture.sessions[name];
  assert(session !== undefined, "Native gateway must issue this credential first");
  return session;
}

async function seedAccounts(db: Db, fixture: Fixture): Promise<void> {
  await db.insert(permissionSets).values({
    id: fixture.setId,
    name: `Core harness ${fixture.setId}`,
    flags: { "permissions.manage": true },
  });
  await db.insert(users).values(
    fixture.userIds.map((id, index) => ({
      id,
      email: fixture.emails[index] ?? "",
      name: `Core harness ${index}`,
      permissionSetId: index === 0 ? fixture.setId : null,
      isAdmin: index === 2,
    })),
  );
  await db.insert(authUsers).values(
    fixture.userIds.map((id, index) => ({
      id,
      email: fixture.emails[index] ?? "",
      name: `Core harness ${index}`,
      emailVerified: true,
    })),
  );
  const context = await createBetterAuth(db).$context;
  const password = await context.password.hash(fixture.password);
  await db.insert(authAccounts).values(
    fixture.userIds.map((userId) => ({
      userId,
      accountId: userId,
      providerId: "credential",
      password,
    })),
  );
  await db.insert(persons).values([
    {
      id: fixture.personIds[0],
      ownerId: fixture.userIds[0],
      name: "Private core person A",
      visibilityLevel: "owner",
    },
    {
      id: fixture.personIds[1],
      ownerId: fixture.userIds[1],
      name: "Private core person B",
      visibilityLevel: "owner",
    },
  ]);
}

async function nativePost(
  db: Db,
  jar: NativeCookieJar,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await nativeAuthGateway(
    db,
    new Request(`${jar.origin}/api/auth${path}`, {
      method: "POST",
      headers: jar.headers(),
      body: JSON.stringify(body),
    }),
  );
  jar.apply(response);
  return response;
}

async function rememberIssued(
  db: Db,
  fixture: Fixture,
  name: SessionName,
  jar: NativeCookieJar,
): Promise<void> {
  const cookie = readCookie(jar.headers(), "wd_sid");
  const token = cookie === null ? null : sessionTokenFromCookie(cookie);
  assert(token !== null, "Native auth must return an actual wd_sid credential");
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSessionCredential(token)))
    .limit(1);
  assert(
    row !== undefined && row.authMethod !== "legacy",
    "Native issuance must persist a modern session",
  );
  fixture.sessions[name] = { id: row.id, cookie: jar.cookie() };
}

async function signIn(
  db: Db,
  fixture: Fixture,
  name: SessionName,
  email: string,
): Promise<NativeCookieJar> {
  const jar = new NativeCookieJar();
  const response = await nativePost(db, jar, "/sign-in/email", {
    email,
    password: fixture.password,
  });
  assert.equal(response.status, 200, "Native gateway password sign-in must succeed");
  await rememberIssued(db, fixture, name, jar);
  return jar;
}

async function issueRegularSessions(db: Db, fixture: Fixture): Promise<void> {
  for (const name of ["a", "revoked", "expired", "idle"] as const)
    await signIn(db, fixture, name, fixture.emails[0]);
  await signIn(db, fixture, "b", fixture.emails[1]);
  const policy = await readAuthPolicy(db, AbortSignal.timeout(5000));
  // Only invalidate/age credentials genuinely issued above; never assign assurance/session rows.
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, issued(fixture, "revoked").id));
  await db
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(sessions.id, issued(fixture, "expired").id));
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date(Date.now() - policy.idleMinutes * 60_000 - 1000) })
    .where(eq(sessions.id, issued(fixture, "idle").id));
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object" || !("data" in error)) return null;
  const data = error.data;
  if (data === null || typeof data !== "object" || !("code" in data)) return null;
  return typeof data.code === "string" ? data.code : null;
}

function client(origin: string, cookie: string | null, observations: Observation[]) {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${origin}/api/trpc`,
        transformer: superjson,
        headers: cookie === null ? {} : { cookie },
        fetch: async (input, init) => {
          const response = await fetch(input, { ...init, signal: AbortSignal.timeout(5000) });
          const address = input instanceof Request ? input.url : String(input);
          observations.push({
            status: response.status,
            timing: response.headers.get("server-timing"),
            batch: new URL(address).searchParams.get("batch") === "1",
          });
          return response;
        },
      }),
    ],
  });
}

async function assertDenied(
  origin: string,
  credential: string | null,
  observations: Observation[],
): Promise<void> {
  await assert.rejects(
    client(origin, credential, observations).identity.assignableUsers.query(),
    (error: unknown) => errorCode(error) === "UNAUTHORIZED",
  );
}

async function checkAuthentication(
  origin: string,
  fixture: Fixture,
  observations: Observation[],
): Promise<void> {
  const credentials = [
    null,
    `wd_sid=${issued(fixture, "a").id}`,
    ...(["revoked", "expired", "idle"] as const).map((name) => issued(fixture, name).cookie),
  ];
  for (const credential of credentials) await assertDenied(origin, credential, observations);
  const forged = await fetch(`${origin}/api/trpc/identity.assignableUsers`, {
    headers: {
      "x-user-id": fixture.userIds[0],
      "x-session-id": issued(fixture, "a").id,
      "x-actor-type": "admin",
    },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(forged.status, 401, "Actor/session headers are not authentication");
}

async function checkNativeMfa(
  db: Db,
  origin: string,
  fixture: Fixture,
  observations: Observation[],
): Promise<void> {
  const jar = await signIn(db, fixture, "pending", fixture.emails[2]);
  await assertDenied(origin, issued(fixture, "pending").cookie, observations);
  const enabled = await nativePost(db, jar, "/two-factor/enable", { password: fixture.password });
  assert.equal(
    enabled.status,
    200,
    "Native admin enrollment must be allowed from pending authentication",
  );
  const enrollment: unknown = await enabled.json();
  assert(
    enrollment !== null &&
      typeof enrollment === "object" &&
      "totpURI" in enrollment &&
      typeof enrollment.totpURI === "string",
    "Native enrollment must return its TOTP URI",
  );
  const secret = new URL(enrollment.totpURI).searchParams.get("secret");
  assert(secret !== null, "Native TOTP secret missing");
  const otp = createOTP(base32.decode(secret));
  const code = await otp.totp();
  const wrong = `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;
  const refused = await nativePost(db, jar, "/two-factor/verify-totp", { code: wrong });
  assert.notEqual(refused.status, 200, "Wrong native factor must not be accepted");
  await assertDenied(origin, jar.cookie(), observations);
  const verified = await nativePost(db, jar, "/two-factor/verify-totp", { code: await otp.totp() });
  assert.equal(verified.status, 200, "Real native TOTP verification must succeed");
  await rememberIssued(db, fixture, "mfa", jar);
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, issued(fixture, "mfa").id));
  assert.equal(row?.assurance, "mfa", "Only native verification may grant MFA assurance");
  const result = await client(
    origin,
    issued(fixture, "mfa").cookie,
    observations,
  ).identity.assignableUsers.query();
  assert(
    result.some((user) => user.id === fixture.userIds[2]),
    "Verified native administrator is admitted",
  );
}

async function checkVisibility(
  origin: string,
  fixture: Fixture,
  observations: Observation[],
): Promise<void> {
  const a = client(origin, issued(fixture, "a").cookie, observations),
    b = client(origin, issued(fixture, "b").cookie, observations);
  const [ownA, ownB, usersA, usersB] = await Promise.all([
    a.contacts.getPerson.query({ id: fixture.personIds[0] }),
    b.contacts.getPerson.query({ id: fixture.personIds[1] }),
    a.identity.assignableUsers.query(),
    b.identity.assignableUsers.query(),
  ]);
  assert.equal(ownA.ownerId, fixture.userIds[0]);
  assert.equal(ownB.ownerId, fixture.userIds[1]);
  assert(
    ownA.createdAt instanceof Date && ownB.createdAt instanceof Date,
    "SuperJSON preserves dates",
  );
  assert(
    usersA.some((user) => user.id === fixture.userIds[0]) &&
      usersB.some((user) => user.id === fixture.userIds[1]),
  );
  await Promise.all([
    assert.rejects(
      a.contacts.getPerson.query({ id: fixture.personIds[1] }),
      (error: unknown) => errorCode(error) === "NOT_FOUND",
    ),
    assert.rejects(
      b.contacts.getPerson.query({ id: fixture.personIds[0] }),
      (error: unknown) => errorCode(error) === "NOT_FOUND",
    ),
    assert.rejects(
      b.identity.listUsers.query(),
      (error: unknown) => errorCode(error) === "FORBIDDEN",
    ),
  ]);
  const managed = await a.identity.listUsers.query();
  assert(
    managed.some((user) => user.id === fixture.userIds[1]),
    "Management permission comes from hydrated DB flags",
  );
}

async function checkDirectParity(
  db: Db,
  origin: string,
  fixture: Fixture,
  observations: Observation[],
): Promise<void> {
  const [{ appRouter }, { createContextFromRequest }] = await Promise.all([
    import("./root"),
    import("./context-core"),
  ]);
  const request = new Request(`${origin}/api/trpc`, {
    headers: { cookie: issued(fixture, "a").cookie },
  });
  const direct = appRouter.createCaller(await createContextFromRequest(request, db));
  const expected = await direct.contacts.getPerson({ id: fixture.personIds[0] });
  const actual = await client(
    origin,
    issued(fixture, "a").cookie,
    observations,
  ).contacts.getPerson.query({ id: fixture.personIds[0] });
  assert.deepEqual(actual, expected, "Real-cookie direct/HTTP result shape must match");
}

async function startHarness(
  db: Db,
  fixture: Fixture,
  state: HarnessState,
  report: CoreHttpHarnessReport,
): Promise<void> {
  const [{ appRouter }, { createContextFromRequest }, { createTrpcHttpHandler }] =
    await Promise.all([import("./root"), import("./context-core"), import("./http")]);
  report.checks.push({ name: "full-router-import-without-Next-request-globals", passed: true });
  state.stage = "native-account-setup";
  state.seeded = true;
  await seedAccounts(db, fixture);
  const handler = createTrpcHttpHandler({
    router: appRouter,
    createContext: async ({ req }) => {
      const context = await createContextFromRequest(req, db);
      if (!state.missingCsrfFacts) return context;
      // Private server-side fixture mode: no request field can activate this.
      const withoutFacts = { ...context };
      delete withoutFacts.csrf;
      return withoutFacts;
    },
    captureError: () => {
      report.unexpectedErrors += 1;
    },
  });
  state.server = bunRuntime().serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 65_536,
    fetch: handler,
  });
  state.origin = state.server.url.origin;
  assert.equal(
    state.server.url.hostname,
    "127.0.0.1",
    "Only an owned loopback listener is allowed",
  );
}

async function exerciseHarness(
  db: Db,
  fixture: Fixture,
  state: HarnessState,
  report: CoreHttpHarnessReport,
  engine: CoreMutationEngineFixture,
): Promise<void> {
  const origin = state.origin;
  assert(origin !== null, "Owned HTTP listener missing");
  const observations: Observation[] = [];
  state.stage = "native-password-issued-cookie-denials";
  await issueRegularSessions(db, fixture);
  await checkAuthentication(origin, fixture, observations);
  report.checks.push({ name: state.stage, passed: true });
  state.stage = "native-pending-admin-wrong-factor-and-real-mfa";
  await checkNativeMfa(db, origin, fixture, observations);
  report.checks.push({ name: state.stage, passed: true });
  state.stage = "interleaved-actor-visibility-permissions";
  await checkVisibility(origin, fixture, observations);
  report.checks.push({ name: state.stage, passed: true });
  state.stage = "direct-http-superjson-parity";
  await checkDirectParity(db, origin, fixture, observations);
  report.checks.push({ name: state.stage, passed: true });
  state.stage = "live-deactivation-denial";
  await db.update(users).set({ isActive: false }).where(eq(users.id, fixture.userIds[1]));
  await assertDenied(origin, issued(fixture, "b").cookie, observations);
  report.checks.push({ name: state.stage, passed: true });
  state.stage = "batching-timing-expected-errors";
  assert(
    observations.some((observation) => observation.batch),
    "Batch transport exercised",
  );
  assert(
    observations.every((observation) => /^trpc;dur=\d+(?:\.\d+)?$/u.test(observation.timing ?? "")),
    "Every response retains Server-Timing",
  );
  assert.equal(
    report.unexpectedErrors,
    0,
    "Authorization errors are expected, not unexpected telemetry",
  );
  assert.equal(report.blockedFetchAttempts, 0, "Selected flows must not attempt provider fetch");
  report.checks.push({ name: state.stage, passed: true });
  report.mutations = await runCoreHttpMutationChecks({
    db,
    origin,
    adminCookie: issued(fixture, "mfa").cookie,
    adminId: fixture.userIds[2],
    engine,
    setMissingCsrfFacts: (missing) => {
      state.missingCsrfFacts = missing;
    },
    stage: (name) => {
      state.stage = name;
    },
    passed: (name) => {
      report.checks.push({ name, passed: true });
    },
  });
  assert.equal(report.unexpectedErrors, 0, "All mutation errors must remain expected");
  assert.equal(report.blockedFetchAttempts, 0, "Mutations must use only owned fixture origins");
}

async function removeFixture(db: Db, fixture: Fixture): Promise<void> {
  await db.delete(persons).where(inArray(persons.id, fixture.personIds));
  await db.delete(authMailOutbox).where(inArray(authMailOutbox.userId, fixture.userIds));
  await db
    .delete(authSecurityEvents)
    .where(
      or(
        inArray(authSecurityEvents.actorId, fixture.userIds),
        inArray(authSecurityEvents.targetUserId, fixture.userIds),
      ),
    );
  await db.delete(authVerifications).where(inArray(authVerifications.value, fixture.userIds));
  await db.delete(sessions).where(inArray(sessions.userId, fixture.userIds));
  await db.delete(authTwoFactors).where(inArray(authTwoFactors.userId, fixture.userIds));
  await db.delete(authAccounts).where(inArray(authAccounts.userId, fixture.userIds));
  await db.delete(authUsers).where(inArray(authUsers.id, fixture.userIds));
  await db.delete(users).where(inArray(users.id, fixture.userIds));
  await db.delete(permissionSets).where(eq(permissionSets.id, fixture.setId));
}

async function ownedRowsRemoved(db: Db, fixture: Fixture): Promise<boolean> {
  const remaining = await Promise.all([
    db.select({ id: users.id }).from(users).where(inArray(users.id, fixture.userIds)),
    db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.userId, fixture.userIds)),
    db.select({ id: authUsers.id }).from(authUsers).where(inArray(authUsers.id, fixture.userIds)),
    db.select({ id: persons.id }).from(persons).where(inArray(persons.id, fixture.personIds)),
    db
      .select({ id: permissionSets.id })
      .from(permissionSets)
      .where(eq(permissionSets.id, fixture.setId)),
  ]);
  return remaining.every((rows) => rows.length === 0);
}

async function nativeResidue(db: Db): Promise<NativeResidue> {
  const [rateLimits, securityEvents, verifications] = await Promise.all([
    db.select({ id: authRateLimits.id }).from(authRateLimits),
    db.select({ id: authSecurityEvents.id }).from(authSecurityEvents),
    db.select({ id: authVerifications.id }).from(authVerifications),
  ]);
  return {
    rateLimits: rateLimits.length,
    securityEvents: securityEvents.length,
    verifications: verifications.length,
  };
}

async function cleanupHarness(
  db: Db,
  fixture: Fixture,
  state: HarnessState,
  report: CoreHttpHarnessReport,
  originalFetch: typeof fetch,
): Promise<void> {
  let stopped = true,
    removed = !state.seeded;
  try {
    await state.server?.stop(true);
  } catch {
    stopped = false;
  }
  globalThis.fetch = originalFetch;
  try {
    if (state.seeded) {
      await removeFixture(db, fixture);
      removed = await ownedRowsRemoved(db, fixture);
    }
    report.nativeResidue = await nativeResidue(db);
  } catch {
    removed = false;
  }
  report.cleanupSuccess = stopped && removed && globalThis.fetch === originalFetch;
}

/** Caller owns and MUST drop the dedicated migrated DB/cluster and close its pool/process. */
export async function runCoreHttpHarness(
  db: Db,
  engine: CoreMutationEngineFixture,
): Promise<CoreHttpHarnessReport> {
  await admitDatabase(db);
  admitCoreMutationEngine(engine);
  const fixture = newFixture(),
    originalFetch = globalThis.fetch,
    started = performance.now();
  const state: HarnessState = {
    origin: null,
    server: null,
    stage: "import-router",
    seeded: false,
    missingCsrfFacts: false,
  };
  const report: CoreHttpHarnessReport = {
    kind: "warpdrive-core-http-cookie-seam",
    success: false,
    checks: [],
    blockedFetchAttempts: 0,
    unexpectedErrors: 0,
    cleanupSuccess: false,
    databaseDropRequired: true,
    seconds: 0,
    limitations: [
      "Owned source-level Bun HTTP/native-gateway-issued cookies/PostgreSQL evidence, not deployed API/image/rollout acceptance.",
      "Selected RPC reads and four mutation adapters; queue startup/dispatch, destructive erasure and exclusive API write ownership are separate gates.",
      "Engine effects use an admitted owned loopback HTTP fixture, not an installed Engine/provider; capture proposal exists only inside the disposable owner database.",
      "Fetch blocking is not an OS network sandbox; anonymous native audit/rate/verification residue is reported and requires caller-owned database teardown.",
    ],
  };
  globalThis.fetch = (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    const requestOrigin = new URL(address).origin;
    if (requestOrigin !== state.origin && requestOrigin !== engine.engineOrigin) {
      report.blockedFetchAttempts += 1;
      return Promise.reject(new TypeError("Provider fetch blocked by Core HTTP harness"));
    }
    return originalFetch(input, init);
  };
  try {
    await startHarness(db, fixture, state, report);
    await exerciseHarness(db, fixture, state, report, engine);
    report.success = true;
  } catch (error) {
    report.failureStage = state.stage;
    report.failureKind = error instanceof Error ? error.name : "UnknownFailure";
  } finally {
    if (state.origin !== null) report.ownedHttpOrigin = state.origin;
    await cleanupHarness(db, fixture, state, report, originalFetch);
    report.success = report.success && report.cleanupSuccess;
    report.seconds = Math.round((performance.now() - started) / 10) / 100;
  }
  return report;
}
