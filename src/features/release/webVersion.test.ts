import { describe, expect, it } from "vitest";
import { err, ok } from "@/types/result";
import { getCurrentVersion } from "./currentVersion";
import { declareWebIdentity } from "./webIdentity";
import { resolveCurrentWebVersion } from "./webVersion";

describe("running Web version resolver", () => {
  it("preserves the existing local Next version path", async () => {
    expect(await resolveCurrentWebVersion(undefined)).toBe(getCurrentVersion());
  });

  it("uses the actual responding Web identity for an independent Core", async () => {
    const signal = new AbortController().signal;
    expect(
      await resolveCurrentWebVersion((actual) => {
        expect(actual).toBe(signal);
        return Promise.resolve(ok(declareWebIdentity("999.1.0", "a".repeat(40))));
      }, signal),
    ).toBe("999.1.0");
  });

  it("maps declared lookup failure to a fixed unavailable error without local fallback", async () => {
    await expect(
      resolveCurrentWebVersion(() => Promise.resolve(err("incompatible"))),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "Web identity unavailable" });
  });

  it("redacts a rejected adapter instead of exposing its error or the Core version", async () => {
    const secret = "generated-sensitive-adapter-diagnostic";
    const result = resolveCurrentWebVersion(() => Promise.reject(new Error(secret)));
    await expect(result).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Web identity unavailable",
    });
    await expect(result).rejects.not.toThrow(secret);
  });
});
