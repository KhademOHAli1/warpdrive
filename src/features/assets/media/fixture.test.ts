import { describe, expect, it } from "vitest";
import { assetsFixture } from "../fixtures";
import { applyAssetWorkspaceCommand } from "../registerCommands";
import {
  type AssetMediaKind,
  type AssetMediaResult,
  type AssetMediaTarget,
  assetDocumentMaxBytes,
  assetPhotoMaxBytes,
} from "./contracts";
import { assetMediaUploadMetadata } from "./fileRules";
import { createAssetMediaFixture } from "./fixture";

const png = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 248, 207, 192, 0, 0, 3, 1, 1,
  0, 9, 111, 175, 111, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function image(name = "Meter.png") {
  return new File([png], name, { type: "image/png" });
}

function pdf() {
  return new File(["%PDF-1.7\nCalibration certificate\n%%EOF"], "Calibration.pdf", {
    type: "application/pdf",
  });
}

function value(result: AssetMediaResult) {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function targets() {
  let register = assetsFixture(true);
  const model = register.models[0];
  const first = register.records.find(({ code }) => code === "METER-101");
  const second = register.records.find(({ code }) => code === "METER-102");
  if (first === undefined || second === undefined || model === undefined)
    throw new Error("Expected the demonstration fleet");
  const firstId = first.id;
  const [firstAsset, secondAsset, fleet] = [
    { type: "asset", id: firstId },
    { type: "asset", id: second.id },
    { type: "model", id: model.id },
  ] as const;
  const media = createAssetMediaFixture(register);

  function upload(target: AssetMediaTarget, version: number, file: File, kind: AssetMediaKind) {
    return {
      target,
      version,
      file,
      kind,
      requestId: crypto.randomUUID(),
    };
  }

  function changeArchive(archived: boolean) {
    const current = register.records.find(({ id }) => id === firstId);
    if (current === undefined) throw new Error("Expected the equipment record");
    const result = applyAssetWorkspaceCommand(
      register,
      {
        type: "setArchive",
        assetId: firstId,
        version: current.version,
        archived,
        reason: "Calibration",
        requestId: crypto.randomUUID(),
      },
      "Demo operator",
    );
    if (!result.ok) throw new Error(result.error);
    register = result.value;
    media.updateRegister(register);
  }

  return {
    ...media,
    model,
    firstAsset,
    secondAsset,
    fleet,
    upload,
    changeArchive,
  };
}

describe("equipment photos and supporting files fixture", () => {
  it("inherits a site model cover, overrides one unit, and keeps earlier photos and files", async () => {
    const { access, dispose, firstAsset, secondAsset, fleet, upload } = targets();
    try {
      const model = value(await access.upload(upload(fleet, 0, image("Fleet.png"), "photo")));
      expect(value(await access.read(firstAsset)).inheritedCover?.id).toBe(model.coverId);
      expect(value(await access.read(secondAsset)).inheritedCover?.id).toBe(model.coverId);
      const first = value(await access.upload(upload(firstAsset, 0, image(), "photo")));
      expect(first.inheritedCover?.id).toBe(model.coverId);
      expect(first.coverId).not.toBe(model.coverId);
      const replacement = value(
        await access.upload(upload(firstAsset, first.version, image("Replacement.png"), "photo")),
      );
      const attached = value(
        await access.upload(upload(firstAsset, replacement.version, pdf(), "document")),
      );
      expect(attached.coverId).toBe(replacement.coverId);
      expect(attached.files.map(({ name }) => name)).toEqual([
        "Calibration.pdf",
        "Replacement.png",
        "Meter.png",
      ]);
      expect(attached.files[0]?.previewHref).toBeNull();
      const older = value(
        await access.setCover({
          target: firstAsset,
          version: attached.version,
          requestId: crypto.randomUUID(),
          fileId: first.coverId,
        }),
      );
      expect(older.coverId).toBe(first.coverId);
      expect(older.history[0]).toMatchObject({ type: "cover_changed", fileId: first.coverId });
      const cleared = value(
        await access.setCover({
          target: firstAsset,
          version: older.version,
          requestId: crypto.randomUUID(),
          fileId: null,
        }),
      );
      expect(cleared.inheritedCover?.id).toBe(model.coverId);
      expect(cleared.files).toEqual(attached.files);
      expect(value(await access.read(secondAsset)).files).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("keeps the file and its identity through archive and reinstatement", async () => {
    const { access, dispose, changeArchive, firstAsset, upload } = targets();
    try {
      const added = value(await access.upload(upload(firstAsset, 0, image(), "photo")));
      changeArchive(true);
      expect(value(await access.read(firstAsset))).toMatchObject({
        version: added.version,
        files: added.files,
        coverId: added.coverId,
        canManage: false,
      });
      expect(await access.upload(upload(firstAsset, added.version, pdf(), "document"))).toEqual({
        ok: false,
        error: "unavailable",
      });
      changeArchive(false);
      expect(value(await access.read(firstAsset))).toEqual(added);
    } finally {
      dispose();
    }
  });

  it("requires current site visibility and write authority and resolves an exact retry once", async () => {
    const { access, dispose, firstAsset, model, updateRegister, upload } = targets();
    try {
      const command = upload(firstAsset, 0, image(), "photo");
      const competing = upload(firstAsset, 0, pdf(), "document");
      const concurrent = await Promise.all([access.upload(command), access.upload(competing)]);
      expect(concurrent.flatMap(({ ok }) => (ok ? [true] : []))).toHaveLength(1);
      const accepted = concurrent[0]?.ok ? command : competing;
      const saved = value(await access.read(firstAsset));
      expect(await access.upload(accepted)).toEqual({ ok: true, value: saved });
      expect(
        await access.upload({ ...accepted, file: image("Different.png"), kind: "photo" }),
      ).toEqual({ ok: false, error: "conflict" });
      expect(saved.files).toHaveLength(1);
      expect(saved.history).toHaveLength(1);
      updateRegister(assetsFixture(false));
      expect(value(await access.read(firstAsset)).canManage).toBe(false);
      expect(await access.upload(accepted)).toEqual({ ok: false, error: "unavailable" });
      const allowed = assetsFixture(true);
      updateRegister({ ...allowed, sites: allowed.sites.filter(({ id }) => id !== model.siteId) });
      expect(await access.read(firstAsset)).toEqual({ ok: false, error: "unavailable" });
    } finally {
      dispose();
    }
  });

  it("rejects mismatched bytes, unsafe names, oversized files, and model documents", async () => {
    const { access, dispose, firstAsset, fleet, upload } = targets();
    try {
      const incorrect = new File(["not an image"], "Meter.png", { type: "image/png" });
      for (const command of [
        upload(firstAsset, 0, incorrect, "photo"),
        upload(firstAsset, 0, image("../Meter.png"), "photo"),
        upload(firstAsset, 0, image(`${"a".repeat(177)}.png`), "photo"),
        upload(fleet, 0, pdf(), "document"),
      ]) {
        expect(await access.upload(command)).toEqual({ ok: false, error: "invalid" });
      }
      expect(
        assetMediaUploadMetadata({
          target: firstAsset,
          kind: "photo",
          name: "Meter.png",
          mime: "image/png",
          sizeBytes: assetPhotoMaxBytes + 1,
        }),
      ).toBeNull();
      expect(
        assetMediaUploadMetadata({
          target: firstAsset,
          kind: "document",
          name: "Calibration.pdf",
          mime: "application/pdf",
          sizeBytes: assetDocumentMaxBytes + 1,
        }),
      ).toBeNull();
      expect(value(await access.read(firstAsset)).files).toEqual([]);
    } finally {
      dispose();
    }
  });
});
