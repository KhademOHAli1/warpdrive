import { afterEach, expect, test, vi } from "vitest";
import type { env as runtimeEnv } from "@/config/env";
import type { Db } from "@/db/client";
import { newsletterConfigured } from "../listmonkClient";
import { synchronizeNewsletterIdentity } from "./events";

vi.mock("@/config/env", async (original) => {
  const loaded = await original<{ env: typeof runtimeEnv }>();
  return {
    ...loaded,
    env: {
      ...loaded.env,
      NEWSLETTER_BASE_URL: "",
      NEWSLETTER_API_USER: "",
      NEWSLETTER_API_TOKEN: "",
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

test("default installations skip newsletter polling before database or network access", async () => {
  const select = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const db = { select } as unknown as Db;
  vi.stubGlobal("fetch", fetch);
  expect(newsletterConfigured()).toBe(false);
  await expect(
    synchronizeNewsletterIdentity(db, AbortSignal.timeout(1000)),
  ).resolves.toBeUndefined();
  expect(select).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
