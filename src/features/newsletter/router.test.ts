import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { newsletterRouter } from "./router";

const db = {} as Db;
const command = { operation: "system.status", input: {} };

describe("native campaign authorization", () => {
  it("requires a live Warpdrive session before evaluating campaign operations", async () => {
    const caller = newsletterRouter.createCaller({ db, actor: null, session: null });
    await expect(caller.read(command)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps installation-wide campaign and audit data unavailable to regular staff", async () => {
    const userId = "2d55209e-948d-4700-b070-1879f6f93710";
    const caller = newsletterRouter.createCaller({
      db,
      actor: {
        id: userId,
        type: "regular",
        isActive: true,
        name: "Test operator",
        email: "operator@example.test",
        avatarUrl: null,
        groupIds: new Set(),
        flags: new Set(),
      },
      session: { userId, sessionId: "a03bdc31-27b0-4980-85df-ce9526e14982" },
    });
    await expect(caller.read(command)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.read({ operation: "admin.logs", input: {} })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.write({ operation: "campaigns.status", input: {}, csrfToken: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
