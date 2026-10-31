import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  authAccounts,
  authTwoFactors,
  authUsers,
  authVerifications,
  sessions,
  users,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { hashSessionAdapter } from "./hashedAdapter";
import { createHashedBackupCodeStorage, hashRecoveryInput } from "./recoveryCodes";

const ORIGIN = "https://qualification.example.com";
const EMAIL = "native-recovery@example.com";
const PASSWORD = "A-strong-recovery-qualification-password";
const ISSUED_CODES = [
  "first-raw-recovery-code",
  "second-raw-recovery-code",
  "third-raw-recovery-code",
];
let h: TestDb;
let userId: string;
let auth: ReturnType<typeof createQualificationAuth>;

function createQualificationAuth(db: TestDb["db"]) {
  return betterAuth({
    secret: "qualification-secret-which-is-over-thirty-two-characters",
    baseURL: ORIGIN,
    database: hashSessionAdapter(
      drizzleAdapter(db, {
        provider: "pg",
        transaction: true,
        schema: {
          user: authUsers,
          account: authAccounts,
          session: sessions,
          verification: authVerifications,
          twoFactor: authTwoFactors,
        },
      }),
      { revokedField: "revokedAt" },
    ),
    advanced: { database: { generateId: () => randomUUID() } },
    session: {
      fields: { token: "tokenHash" },
      disableSessionRefresh: true,
      additionalFields: { revokedAt: { type: "date", required: false, input: false } },
    },
    rateLimit: { enabled: false },
    emailAndPassword: { enabled: true },
    plugins: [
      twoFactor({
        allowPasswordless: true,
        backupCodeOptions: { storeBackupCodes: createHashedBackupCodeStorage() },
      }),
    ],
    hooks: {
      before: createAuthMiddleware((ctx) =>
        Promise.resolve().then(() => {
          if (ctx.path === "/two-factor/verify-backup-code" && typeof ctx.body?.code === "string") {
            return { context: { body: { ...ctx.body, code: hashRecoveryInput(ctx.body.code) } } };
          }
        }),
      ),
    },
  });
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0] ?? "")
    .filter((value) => value.length > value.indexOf("=") + 1)
    .join("; ");
}

async function request(path: string, body: Record<string, unknown>, cookie = "") {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify(body),
    }),
  );
}

async function beginChallenge(): Promise<string> {
  const response = await request("/sign-in/email", { email: EMAIL, password: PASSWORD });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
  const cookie = cookieHeader(response);
  expect(cookie).toContain("two_factor");
  return cookie;
}

beforeAll(async () => {
  h = await makeTestDb();
  userId = randomUUID();
  await h.db.insert(users).values({ id: userId, email: EMAIL, name: "Recovery qualification" });
  await h.db.insert(authUsers).values({
    id: userId,
    email: EMAIL,
    name: "Recovery qualification",
    emailVerified: true,
    twoFactorEnabled: true,
  });
  auth = createQualificationAuth(h.db);
  const context = await auth.$context;
  await h.db.insert(authAccounts).values({
    userId,
    accountId: userId,
    providerId: "credential",
    password: await context.password.hash(PASSWORD),
  });
  // The fixture represents a user who already confirmed enrollment. These checks qualify
  // native recovery redemption, not authenticator enrollment or the application admission policy.
  await h.db.insert(authTwoFactors).values({
    userId,
    secret: "not-used-by-recovery-redemption",
    backupCodes: await createHashedBackupCodeStorage().encrypt(JSON.stringify(ISSUED_CODES)),
    verified: true,
  });
});
afterAll(async () => {
  await h.close();
});

describe("native Better Auth recovery-code qualification", () => {
  test("rejects stored digests, atomically redeems raw codes, and prevents replay", async () => {
    const [before] = await h.db
      .select()
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, userId));
    expect(before?.backupCodes).not.toContain(ISSUED_CODES[0]);
    const cookie = await beginChallenge();
    const leakedDigest = hashRecoveryInput(ISSUED_CODES[0] ?? "");
    const invalid = await request("/two-factor/verify-backup-code", { code: leakedDigest }, cookie);
    expect(invalid.status).toBe(401);

    const results = await Promise.all([
      request("/two-factor/verify-backup-code", { code: ISSUED_CODES[0] }, cookie),
      request("/two-factor/verify-backup-code", { code: ISSUED_CODES[0] }, cookie),
    ]);
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(results.filter((response) => response.status !== 200)).toHaveLength(1);
    const [after] = await h.db
      .select()
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, userId));
    expect(after?.backupCodes).not.toContain(leakedDigest);
    expect(after?.backupCodes).toContain(hashRecoveryInput(ISSUED_CODES[1] ?? ""));

    const newChallenge = await beginChallenge();
    expect(
      (await request("/two-factor/verify-backup-code", { code: ISSUED_CODES[0] }, newChallenge))
        .status,
    ).toBe(401);
    const recovered = await request(
      "/two-factor/verify-backup-code",
      { code: ISSUED_CODES[1] },
      newChallenge,
    );
    expect(recovered.status).toBe(200);
    const body = (await recovered.json()) as { token: string };
    const stored = await h.db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(stored.length).toBeGreaterThan(0);
    expect(JSON.stringify(stored)).not.toContain(body.token);
    const authenticatedCookie = cookieHeader(recovered);
    const currentSession = () =>
      auth.handler(
        new Request(`${ORIGIN}/api/auth/get-session`, {
          headers: { origin: ORIGIN, cookie: authenticatedCookie },
        }),
      );
    expect(await (await currentSession()).json()).toMatchObject({ user: { id: userId } });
    await h.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
    expect(await (await currentSession()).json()).toBeNull();
  });
});
