import { describe, expect, it } from "vitest";
import { assetTagLink, assetTagText, isAssetTagToken, parseAssetTagIdentifier } from "./tagCodes";

const origin = "https://assets.example.test:8443";
const token = "aBcDeFgHiJkLmNpQrSt-_2";
const tagUrl = `${origin}/equipment-tag/${token}`;

describe("asset tag links", () => {
  it("round trips case-sensitive tag markers, links, and supported scanner framing", () => {
    expect(isAssetTagToken(token)).toBe(true);
    const marker = assetTagText(token);
    expect(marker).toBe(`wd-tag:v1:${token}`);
    expect(assetTagLink(`${origin}/`, token)).toBe(tagUrl);
    expect(parseAssetTagIdentifier(marker, origin)).toBe(token);
    expect(parseAssetTagIdentifier(`]Q2${tagUrl}\r\n`, origin)).toBe(token);
    expect(parseAssetTagIdentifier(`${marker}\r`, origin)).toBe(token);
    expect(parseAssetTagIdentifier(assetTagText(token.toUpperCase()), origin)).toBe(
      token.toUpperCase(),
    );
    expect(assetTagLink("http://127.0.0.1:3000", token)).toBe(
      `http://127.0.0.1:3000/equipment-tag/${token}`,
    );
  });

  it("separates raw tag namespaces and rejects malformed opaque tokens", () => {
    for (const invalid of [token.slice(1), `${token}=`, `${token}\n`, token.replace("_", "/")]) {
      expect(isAssetTagToken(invalid)).toBe(false);
      expect(assetTagLink(origin, invalid)).toBeNull();
    }
    expect(parseAssetTagIdentifier(token, origin)).toBeNull();
    expect(parseAssetTagIdentifier(`wd-label:v1:${token}`, origin)).toBeNull();
    expect(parseAssetTagIdentifier(`WD-TAG:v1:${token}`, origin)).toBeNull();
    expect(parseAssetTagIdentifier(`wd-tag:v1:${token}=`, origin)).toBeNull();
  });

  it("accepts only the exact route on the configured origin", () => {
    for (const invalid of [
      tagUrl.replace("assets.example.test", "untrusted.example.test"),
      tagUrl.replace("8443", "8444"),
      tagUrl.replace("https://", "http://"),
      tagUrl.replace("https://", "https://user@"),
      tagUrl.replace("/equipment-tag/", "/prefix/../equipment-tag/"),
      tagUrl.replace("/equipment-tag/", "/%65quipment-tag/"),
      tagUrl.replace("/equipment-tag/", "/equipment-tag%2f"),
      tagUrl.replace("/equipment-tag/", "/equipment-tag//"),
      tagUrl.replace("/equipment-tag/", "\\equipment-tag\\"),
      `${tagUrl}#`,
      `${tagUrl}?`,
      `${tagUrl}/`,
      ` ${tagUrl}`,
      `/equipment-tag/${token}`,
      `//assets.example.test:8443/equipment-tag/${token}`,
      `]C0${tagUrl}`,
    ]) {
      expect(parseAssetTagIdentifier(invalid, origin), invalid).toBeNull();
    }
    expect(assetTagLink(`${origin}/elsewhere`, token)).toBeNull();
    expect(assetTagLink(`${origin}#`, token)).toBeNull();
    expect(assetTagLink("https://user@assets.example.test:8443", token)).toBeNull();
    expect(assetTagLink(`${origin}\n`, token)).toBeNull();
  });
});
