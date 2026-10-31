import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { authRateLimits } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createAuthRateLimiter } from "./rateLimit";

let h: TestDb;
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.db.delete(authRateLimits);
});

describe("shared authentication rate limits", () => {
  test("allows exactly twenty concurrent sensitive attempts across instances", async () => {
    const replicas = [
      createAuthRateLimiter("x-real-ip"),
      createAuthRateLimiter("x-real-ip"),
    ] as const;
    const headers = new Headers({ "x-real-ip": "192.0.2.10" });
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) => {
        const enforce = replicas[index % 2] ?? replicas[0];
        return enforce(h.db, headers, "/sign-in/email", "user@example.com", signal());
      }),
    );
    expect(results.filter(Boolean)).toHaveLength(20);
  });

  test("does not permit account rotation or endpoint rotation to evade an IP budget", async () => {
    const enforce = createAuthRateLimiter("x-real-ip");
    const headers = new Headers({ "x-real-ip": "192.0.2.11" });
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        enforce(
          h.db,
          headers,
          index % 2 ? "/sign-in/email" : "/reset-password",
          `target-${index}`,
          signal(),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(20);
  });

  test("enforces an account budget across different trusted client addresses", async () => {
    const enforce = createAuthRateLimiter("x-real-ip");
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        enforce(
          h.db,
          new Headers({ "x-real-ip": `192.0.2.${index + 1}` }),
          "/sign-in/email",
          "same@example.com",
          signal(),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(
      await enforce(
        h.db,
        new Headers({ "x-real-ip": "198.51.100.5" }),
        "/sign-in/email",
        "another@example.com",
        signal(),
      ),
    ).toBe(true);
  });

  test("uses the global unknown-IP budget while ignoring spoofed headers", async () => {
    const enforce = createAuthRateLimiter("none");
    const results = await Promise.all(
      Array.from({ length: 201 }, (_, index) =>
        enforce(
          h.db,
          new Headers({ "x-real-ip": `192.0.2.${index + 1}` }),
          "/sign-in/email",
          undefined,
          signal(),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(200);
  });

  test("resets an expired window atomically and stores no raw identity", async () => {
    const enforce = createAuthRateLimiter("x-real-ip");
    const headers = new Headers({ "x-real-ip": "203.0.113.9" });
    await enforce(h.db, headers, "/sign-in/email", "private@example.com", signal());
    const rows = await h.db.select().from(authRateLimits);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9");
    expect(JSON.stringify(rows)).not.toContain("private@example.com");
    for (const row of rows) {
      await h.db
        .update(authRateLimits)
        .set({ count: 20, lastRequest: Date.now() - 61_000 })
        .where(eq(authRateLimits.id, row.id));
    }
    expect(await enforce(h.db, headers, "/sign-in/email", "private@example.com", signal())).toBe(
      true,
    );
    expect((await h.db.select().from(authRateLimits)).every((row) => row.count === 1)).toBe(true);
  });

  test("does not consume a budget when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createAuthRateLimiter("none")(
        h.db,
        new Headers(),
        "/sign-in/email",
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(await h.db.select().from(authRateLimits)).toHaveLength(0);
  });
});
