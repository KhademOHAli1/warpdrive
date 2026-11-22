import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import formats from "./attachmentIconFormats.json";
import { attachmentIconPath } from "./attachmentIconPath";

it.each([
  ["report.PDF", "pdf"],
  ["C:\\exports\\chassis.STP", "step"],
  ["video.MP4", "mp4"],
  ["photo.jpeg", "jpeg"],
  ["package.ZIP", "zip"],
  ["release.v2.TAR.GZ", "tgz"],
  ["trace.gz", "gz"],
  ["controller.js.map", "source-map"],
  ["config/.env", "env"],
  ["readme", "file"],
  ["sample.key", "file"],
  ["sample.unknown", "file"],
  ["sample.constructor", "file"],
  ["report.pdf.unknown", "file"],
])("chooses the icon for %s", (filename, icon) => {
  expect(attachmentIconPath(filename)).toBe(`/file-format-icons/${icon}.svg`);
});

it("serves a bundled SVG for every configured icon", () => {
  const iconIds = new Set([
    formats.fallback,
    ...Object.values(formats.filenameMap),
    ...Object.values(formats.extensionMap),
  ]);
  for (const id of iconIds) {
    expect(existsSync(join("public", "file-format-icons", `${id}.svg`)), id).toBe(true);
  }
});
