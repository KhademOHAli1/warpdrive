import { expect, test } from "vitest";
import { env } from "@/config/env";
import { getCurrentVersion } from "@/features/release/currentVersion";
import { GET } from "./route";

test("declares only public Web process metadata without caching or database work", async () => {
  const reply = GET();
  expect(reply.headers.get("cache-control")).toBe("no-store");
  expect(await reply.json()).toEqual({
    contract: "warpdrive.web.identity.v1",
    component: "web",
    version: getCurrentVersion(),
    sourceRevision: /^[a-f0-9]{40}$/u.test(env.APP_COMMIT) ? env.APP_COMMIT : null,
  });
});
