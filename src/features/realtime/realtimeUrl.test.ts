import { describe, expect, it } from "vitest";
import { resolveRealtimeUrl } from "./realtimeUrl";

describe("resolveRealtimeUrl", () => {
  it("uses the current HTTPS origin so one build works in staging and production", () => {
    expect(
      resolveRealtimeUrl("same-origin", { protocol: "https:", host: "staging.example.com" }),
    ).toBe("wss://staging.example.com/_ws");
    expect(resolveRealtimeUrl("same-origin", { protocol: "https:", host: "crm.example.com" })).toBe(
      "wss://crm.example.com/_ws",
    );
  });

  it("uses ws for HTTP and preserves explicit ports and bracketed IPv6 hosts", () => {
    expect(resolveRealtimeUrl("same-origin", { protocol: "http:", host: "localhost:3000" })).toBe(
      "ws://localhost:3000/_ws",
    );
    expect(resolveRealtimeUrl("same-origin", { protocol: "https:", host: "[::1]:3443" })).toBe(
      "wss://[::1]:3443/_ws",
    );
  });

  it("keeps an empty endpoint disabled", () => {
    expect(resolveRealtimeUrl("")).toBe("");
    expect(resolveRealtimeUrl("", { protocol: "https:", host: "crm.example.com" })).toBe("");
  });

  it("preserves existing explicit endpoint overrides exactly", () => {
    const override = "wss://realtime.example.com:9443/custom/path?region=eu";
    expect(resolveRealtimeUrl(override)).toBe(override);
    expect(resolveRealtimeUrl(override, { protocol: "https:", host: "crm.example.com" })).toBe(
      override,
    );
  });

  it("does not invent a browser origin during SSR or for non-HTTP locations", () => {
    expect(resolveRealtimeUrl("same-origin")).toBe("");
    expect(resolveRealtimeUrl("same-origin", { protocol: "file:", host: "" })).toBe("");
    expect(resolveRealtimeUrl("same-origin", { protocol: "chrome-extension:", host: "abc" })).toBe(
      "",
    );
    expect(resolveRealtimeUrl("same-origin", { protocol: "https:", host: "" })).toBe("");
  });
});
