import { describe, expect, it, vi } from "vitest";
import type * as Environment from "@/config/env";
import { admitCoreMutationEngine } from "./core-http-mutations.harness";

vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof Environment>();
  return { ...actual, env: { ...actual.env, NEWSLETTER_BASE_URL: "http://127.0.0.1:43123" } };
});

const owned = {
  engineOrigin: "http://127.0.0.1:43123",
  engineNonce: "owned-fixture-nonce-".repeat(2),
};

describe("native mutation fixture Engine admission", () => {
  it("admits only the exact loopback origin bound before application imports", () => {
    expect(() => admitCoreMutationEngine(owned)).not.toThrow();
  });

  it("rejects alternate origins and credentials before any provider request", () => {
    for (const engineOrigin of [
      "https://engine.example.test",
      "http://newsletter-engine:9000",
      "http://127.0.0.1:43124",
      "http://127.0.0.1",
      "http://localhost:43123",
      "http://user:secret@127.0.0.1:43123",
      "http://127.0.0.1:43123/path",
      "http://127.0.0.1:43123?query=value",
      "http://127.0.0.1:43123#fragment",
    ])
      expect(() => admitCoreMutationEngine({ ...owned, engineOrigin })).toThrow();
  });

  it("requires a bounded dedicated nonce instead of trusting a local service by address", () => {
    for (const engineNonce of [
      "",
      "short",
      "x".repeat(129),
      `${owned.engineNonce}:`,
      " ".repeat(40),
    ])
      expect(() => admitCoreMutationEngine({ ...owned, engineNonce })).toThrow();
  });
});
