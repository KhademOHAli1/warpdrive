import { expect, it } from "vitest";
import { auditFixtureData, changeLiveAuditDemoEquipment } from "./fixtureData";
import { auditFixturePhotoFingerprint } from "./fixturePhoto";

it("preserves the independent source snapshot while changing the demo register", () => {
  const { assets, siteId, roster } = auditFixtureData();
  const moved = changeLiveAuditDemoEquipment(assets);
  const meterName = (state: typeof assets) =>
    state.records.find(({ code }) => code === "METER-101")?.name;
  const balance = (state: typeof assets) => state.records.find(({ code }) => code === "LEAD-SET");
  expect(meterName(moved)).toBe("Bench meter after relocation");
  expect(meterName(assets)).toBe("Bench multimeter");
  expect(balance(assets)).toMatchObject({ balances: [{ quantity: 12 }, { quantity: 8 }] });
  expect(balance(moved)).toMatchObject({ balances: [{ quantity: 17 }, { quantity: 8 }] });
  expect(roster[siteId]?.map(({ name }) => name)).toEqual([
    "Mara Keller",
    "Elias Weber",
    "Nora Weiss",
  ]);
  expect(assets.kits?.records[0]?.lines).toMatchObject([{ packedQuantity: 3 }]);
  expect(assets.custody?.holdings[0]).toMatchObject({ custodianName: "Elias Weber", quantity: 1 });
});

it("fingerprints the same image bytes and rejects an invalid photo", async () => {
  const image = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/A0AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const make = (name: string, mimeType: string) => new File([image], name, { type: mimeType });
  const first = await auditFixturePhotoFingerprint(make("first.png", "image/png"));
  expect(first).toMatch(/^[0-9a-f]{64}$/u);
  expect(await auditFixturePhotoFingerprint(make("copy.png", "image/png"))).toBe(first);
  expect(await auditFixturePhotoFingerprint(make("invalid.jpg", "image/jpeg"))).toBeNull();
});
