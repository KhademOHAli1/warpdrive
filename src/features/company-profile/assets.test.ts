import sharp from "sharp";
import { expect, it } from "vitest";
import { sanitizeCompanyAsset } from "./assetSanitizer";

it("decodes, crops and strips metadata before producing bounded PNG bytes", async () => {
  const source = await sharp({
    create: { width: 40, height: 20, channels: 4, background: "#ff0000" },
  })
    .jpeg()
    .withMetadata({ orientation: 1 })
    .toBuffer();
  expect((await sharp(source).metadata()).exif).toBeDefined();
  const result = await sanitizeCompanyAsset(
    source,
    "icon",
    { left: 0.5, top: 0, width: 0.5, height: 1 },
    new AbortController().signal,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const metadata = await sharp(result.value.bytes).metadata();
  expect(metadata).toMatchObject({ format: "png", width: 20, height: 20 });
  expect(metadata.exif).toBeUndefined();
});
it("rejects SVG, corrupt raster data, oversized actual bytes and invalid crop", async () => {
  const signal = new AbortController().signal;
  for (const bytes of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.alloc(2097153),
  ]) {
    expect((await sanitizeCompanyAsset(bytes, "logo", undefined, signal)).ok).toBe(false);
  }
  const source = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  expect(
    (
      await sanitizeCompanyAsset(
        source,
        "logo",
        { left: 0.8, top: 0, width: 0.5, height: 1 },
        signal,
      )
    ).ok,
  ).toBe(false);
});
