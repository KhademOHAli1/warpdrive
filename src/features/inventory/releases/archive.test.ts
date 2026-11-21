import { assert, expect, test } from "vitest";
import { inventoryFixture } from "../fixtures";
import { validReleaseArchive } from "./archive";
import { parseReleaseBom } from "./bomCsv";
import { createReleaseFixture } from "./fixtures";

async function sampleArchive() {
  const product = inventoryFixture(undefined).items.find(({ kind }) => kind === "product");
  assert(product);
  const file = createReleaseFixture(product).releases[0]?.artifacts.find(
    ({ kind }) => kind === "pcbFabrication",
  );
  assert(file);
  return Buffer.from(await file.bytes.arrayBuffer());
}

const signal = new AbortController().signal;

test("validates the fabrication package and detects truncated or changed compressed contents", async () => {
  const archive = await sampleArchive();
  expect(validReleaseArchive(archive, true, signal)).toBe(true);
  expect(validReleaseArchive(archive.subarray(0, archive.length - 1), true, signal)).toBe(false);

  const damaged = Buffer.from(archive);
  const compressedOffset = 30 + damaged.readUInt16LE(26) + damaged.readUInt16LE(28);
  damaged.writeUInt8(damaged.readUInt8(compressedOffset) ^ 0xff, compressedOffset);
  expect(validReleaseArchive(damaged, true, signal)).toBe(false);
});

test("refuses unsafe entry paths and excessive expanded sizes", async () => {
  const archive = await sampleArchive();
  const unsafePath = Buffer.from(archive);
  const original = "demo-top.gbr";
  const localName = unsafePath.indexOf(original);
  const centralName = unsafePath.indexOf(original, localName + original.length);
  expect(localName).toBeGreaterThanOrEqual(0);
  expect(centralName).toBeGreaterThan(localName);
  unsafePath.write("../board.gbr", localName);
  unsafePath.write("../board.gbr", centralName);
  expect(validReleaseArchive(unsafePath, true, signal)).toBe(false);

  const oversized = Buffer.from(archive);
  const central = oversized.readUInt32LE(oversized.length - 22 + 16);
  oversized.writeUInt32LE(128 * 1024 * 1024, central + 24);
  expect(validReleaseArchive(oversized, true, signal)).toBe(false);
});

test("accepts BOM spreadsheet quoting and rejects ambiguous or invalid material rows", () => {
  expect(
    parseReleaseBom(Buffer.from('\uFEFF"SKU", "quantity"\r\n"pcb-01", "2"\r\nENCLOSURE,1\r\n')),
  ).toEqual([
    { sku: "PCB-01", quantity: 2 },
    { sku: "ENCLOSURE", quantity: 1 },
  ]);
  expect(parseReleaseBom(Buffer.from("sku,quantity\npcb-01,1\nPCB-01,2"))).toBeNull();
  expect(parseReleaseBom(Buffer.from("sku,quantity\nPCB-01,1,extra"))).toBeNull();
  expect(parseReleaseBom(Buffer.from("sku,quantity\nPCB-01,1.5"))).toBeNull();
  expect(parseReleaseBom(Buffer.from("sku,quantity\nPCB-01,1000001"))).toBeNull();
});
