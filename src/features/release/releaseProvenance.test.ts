import { afterEach, describe, expect, it, vi } from "vitest";
import { isDistributionReleaseUrl } from "./releaseProvenance";

afterEach(() => {
  vi.doUnmock("./constants");
  vi.resetModules();
});

describe("isDistributionReleaseUrl", () => {
  it.each([
    "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
    "https://github.com/khademohali1/WARPDRIVE/releases/tag/v1.5.2",
    "https://github.com:443/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
  ])("accepts a release page for this distribution: %s", (url) => {
    expect(isDistributionReleaseUrl(url)).toBe(true);
  });

  it.each([
    null,
    "",
    "not a URL",
    "https://github.com/sneg55/warpdrive/releases/tag/v1.5.2",
    "https://github.com/KhademOHAli1/other-repository/releases/tag/v1.5.2",
    "https://github.com/KhademOHAli1/warpdrive-extra/releases/tag/v1.5.2",
    "https://github.com.attacker.example/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
    "https://github.com@attacker.example/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
    "https://user:password@github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
    "http://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
    "https://github.com:8443/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
    "https://github.com/KhademOHAli1/warpdrive/releases/tag/",
    "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2/extra",
    "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2?redirect=upstream",
    "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2#fragment",
    " https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
    "https://github.com/%4bhademOHAli1/warpdrive/releases/tag/v1.5.2",
  ])("rejects unknown, foreign or ambiguous provenance: %s", (url) => {
    expect(isDistributionReleaseUrl(url)).toBe(false);
  });

  it("follows a fork's source-configured endpoint without a second repository setting", async () => {
    vi.resetModules();
    vi.doMock("./constants", () => ({
      GITHUB_RELEASES_URL:
        "https://api.github.com/repos/another-owner/another-fork/releases/latest",
    }));
    const { isDistributionReleaseUrl: isForkReleaseUrl } = await import("./releaseProvenance");
    expect(
      isForkReleaseUrl("https://github.com/another-owner/another-fork/releases/tag/v1.5.2"),
    ).toBe(true);
    expect(isForkReleaseUrl("https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2")).toBe(
      false,
    );
  });
});
