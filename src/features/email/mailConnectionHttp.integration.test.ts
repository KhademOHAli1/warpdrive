import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { createMailConnectionHttp } from "./mailConnectionHttp";
import { seedMailHttpSession, syntheticCheckedMailbox } from "./mailConnectionHttp.test-helpers";

const checked = {
  checkId: "a".repeat(64),
  mailboxAddress: "owner@example.test",
  folders: syntheticCheckedMailbox.folders,
  capabilities: syntheticCheckedMailbox.capabilities,
};
const checker = () => vi.fn(() => Promise.resolve(ok(checked)));
function post(
  origin: string,
  headers: Headers,
  path = "check",
  body: unknown = syntheticCheckedMailbox.input,
) {
  return new Request(`${origin}/api/mail-connections/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("mail connection HTTP boundary", () => {
  it("accepts fresh native authority, returns value-contract JSON and forbids caching", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const check = checker();
      const response = await createMailConnectionHttp(db, { check })(post(f.origin, f.headers));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(ok(checked));
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(check).toHaveBeenCalledWith(
        db,
        f.context,
        syntheticCheckedMailbox.input,
        expect.any(AbortSignal),
      );
    });
  });

  it.each([
    { assurance: "pending" as const },
    { isAdmin: true },
    { emailVerified: false },
    { isActive: false },
    { expiresAt: new Date(Date.now() - 1000) },
  ])("rejects invalid native authority before touching a provider", async (options) => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db, options);
      const check = checker();
      const response = await createMailConnectionHttp(db, { check })(post(f.origin, f.headers));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: "permission" });
      expect(check).not.toHaveBeenCalled();
    });
  });

  it("requires fresh authentication for writes while allowing a valid stale session to list", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db, { freshAt: new Date(Date.now() - 600_000) });
      const check = checker();
      const handle = createMailConnectionHttp(db, { check });
      const denied = await handle(post(f.origin, f.headers));
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ ok: false, error: "fresh_auth_required" });
      const listed = await handle(
        new Request(`${f.origin}/api/mail-connections/list`, { headers: f.headers }),
      );
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual(ok([]));
      expect(check).not.toHaveBeenCalled();
    });
  });

  it.each(["csrf", "origin", "cross-site", "content-type"])(
    "enforces %s before provider calls",
    async (failure) => {
      await withTestDb(async (db) => {
        const f = await seedMailHttpSession(db);
        const headers = new Headers(f.headers);
        if (failure === "csrf") headers.set("x-csrf-token", "mismatch");
        if (failure === "origin") headers.set("origin", "https://attacker.example");
        if (failure === "cross-site") headers.set("sec-fetch-site", "cross-site");
        if (failure === "content-type") headers.set("content-type", "text/plain");
        const check = checker();
        const response = await createMailConnectionHttp(db, { check })(post(f.origin, headers));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ ok: false, error: "permission" });
        expect(check).not.toHaveBeenCalled();
      });
    },
  );

  it("uses a shared real-PostgreSQL rate budget for the authenticated actor", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const check = checker();
      const handle = createMailConnectionHttp(db, { check });
      for (let index = 0; index < 20; index++)
        expect((await handle(post(f.origin, f.headers))).status).toBe(200);
      const denied = await handle(post(f.origin, f.headers));
      expect(denied.status).toBe(429);
      expect(await denied.json()).toEqual({ ok: false, error: "rate_limit" });
      expect(check).toHaveBeenCalledTimes(20);
      const other = await seedMailHttpSession(db);
      expect((await handle(post(other.origin, other.headers))).status).toBe(200);
    });
  });

  it("does not serialize thrown provider errors, credentials, or stacks", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const response = await createMailConnectionHttp(db, {
        check: () => Promise.reject(new Error("synthetic-password-in-provider-stack")),
      })(post(f.origin, f.headers));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ ok: false, error: "unknown" });
    });
  });

  it("does not wait indefinitely for a dependency that ignores the request deadline", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const result = createMailConnectionHttp(db, {
        timeoutMs: 100,
        check: () => new Promise(() => {}),
      })(post(f.origin, f.headers));
      const response = await Promise.race([
        result,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
      expect(response).toBeInstanceOf(Response);
      expect(response?.status).toBe(408);
      expect(await response?.json()).toEqual({ ok: false, error: "network" });
    });
  });

  it("does not permit changing another owner's connection through the HTTP mutation route", async () => {
    await withTestDb(async (db) => {
      const owner = await seedMailHttpSession(db);
      const other = await seedMailHttpSession(db);
      const row = (
        await db.execute(
          sql`INSERT INTO email_accounts(user_id,email_address,provider) VALUES(${other.user.id},'other@example.test','imap_smtp') RETURNING id`,
        )
      ).rows[0] as { id: string };
      const response = await createMailConnectionHttp(db)(
        post(owner.origin, owner.headers, "mutate", { accountId: row.id, action: "pause" }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: "permission" });
      expect(
        (
          await db.execute(
            sql`SELECT paused,connection_generation FROM email_accounts WHERE id=${row.id}`,
          )
        ).rows[0],
      ).toEqual({ paused: false, connection_generation: 1 });
    });
  });
});

it("accepts a freshly verified administrator MFA session", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db, {
      isAdmin: true,
      twoFactorEnabled: true,
      assurance: "mfa",
      mfaAt: new Date(),
    });
    const response = await createMailConnectionHttp(db, { check: checker() })(
      post(f.origin, f.headers),
    );
    expect(response.status).toBe(200);
  });
});

it("rejects oversized streamed UTF-8 at the authenticated boundary before provider work", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db);
    const check = checker();
    const headers = new Headers(f.headers);
    headers.set("content-length", "1");
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ name: "ف".repeat(20_000) })));
      },
      cancel() {
        cancelled = true;
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers,
      body,
      duplex: "half",
    };
    const response = await createMailConnectionHttp(db, { check })(
      new Request(`${f.origin}/api/mail-connections/check`, init),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(check).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
  });
});
