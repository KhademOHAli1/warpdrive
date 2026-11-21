import type { InventoryItem } from "@/features/inventory/contracts";
import { err, ok } from "@/types/result";
import {
  type ManufacturingRelease,
  type ReleaseArtifact,
  type ReleaseArtifactKind,
  type ReleaseFixtureCommand,
  type ReleaseFixtureResult,
  type ReleaseFixtureState,
  releaseFixtureMaxFileBytes,
} from "./contracts";

const requiredArtifacts = ["pcbFabrication", "manufacturingBom"] as const;
const requiredExtensions: Partial<Record<ReleaseArtifactKind, string>> = {
  pcbFabrication: ".zip",
  manufacturingBom: ".csv",
};

// Deterministic ZIP containing demo-top.gbr and demo-drill.drl with synthetic data.
const fabricationZipBase64 =
  "UEsDBBQAAAAIAAAAIQCDdnxDQAAAAEAAAAAMAAAAZGVtby10b3AuZ2JyczcwUQhPLCpIKcosS1UorswryUgtyUxWCHB2UkjLrCgpLUrV4lJ1C/ZxjDAyiTQy0VLlUvX19/UF0r4GRlpcAFBLAwQUAAAACAAAACEA2paslTcAAAA3AAAADgAAAGRlbW8tZHJpbGwuZHJs8zWx4LIOTywqSCnKLEtVKK7MK8lILclMVgDyc3IU0jIrSkqLUrl8XUOCPJ11QqK4VLl8jQ24AFBLAQIUAxQAAAAIAAAAIQCDdnxDQAAAAEAAAAAMAAAAAAAAAAAAAACAAQAAAABkZW1vLXRvcC5nYnJQSwECFAMUAAAACAAAACEA2paslTcAAAA3AAAADgAAAAAAAAAAAAAAgAFqAAAAZGVtby1kcmlsbC5kcmxQSwUGAAAAAAIAAgB2AAAAzQAAAAAA";

function seedArtifact(
  revision: string,
  kind: ReleaseArtifactKind,
  name: string,
  bytes: Blob,
): ReleaseArtifact {
  return { id: `${revision}-${kind}`, kind, name, sizeBytes: bytes.size, bytes };
}

function seedBom(revision: string): ReleaseArtifact {
  return seedArtifact(
    revision,
    "manufacturingBom",
    `IO-24-DIN-${revision}-bom.csv`,
    new Blob(["sku,quantity\nPCB-IO-24,1\nENC-DIN-01,1\nLBL-IO-24,1\n"], { type: "text/csv" }),
  );
}

export function createReleaseFixture(item: InventoryItem): ReleaseFixtureState {
  if (item.kind !== "product" || item.sku !== "IO-24-DIN") {
    return { releases: [], activeRevision: null, builds: [] };
  }

  const fabricationZip = Uint8Array.from(atob(fabricationZipBase64), (byte) => byte.charCodeAt(0));
  return {
    releases: [
      {
        revision: "A",
        status: "released",
        releasedAt: "2026-11-20T09:00:00.000Z",
        artifacts: [
          seedArtifact(
            "A",
            "pcbFabrication",
            "IO-24-DIN-A-fabrication-demo.zip",
            new Blob([fabricationZip], { type: "application/zip" }),
          ),
          seedBom("A"),
          seedArtifact(
            "A",
            "placement",
            "IO-24-DIN-A-placement-demo.csv",
            new Blob(["reference,x_mm,y_mm,rotation_deg,side\nD1,10,8,0,top\n"], {
              type: "text/csv",
            }),
          ),
          seedArtifact(
            "A",
            "testInstructions",
            "IO-24-DIN-A-test-instructions-demo.txt",
            new Blob(["Demonstration instructions\nRecord the result of each channel check.\n"], {
              type: "text/plain",
            }),
          ),
        ],
      },
      { revision: "B", status: "draft", artifacts: [seedBom("B")], releasedAt: null },
    ],
    activeRevision: "A",
    builds: [{ id: "BUILD-001", revision: "A" }],
  };
}

export function missingReleaseArtifacts(release: ManufacturingRelease): ReleaseArtifactKind[] {
  return requiredArtifacts.filter(
    (kind) => !release.artifacts.some((artifact) => artifact.kind === kind),
  );
}

function normalizeRevision(revision: string): string {
  return revision.trim().toUpperCase();
}

function createDraft(state: ReleaseFixtureState, revision: string): ReleaseFixtureResult {
  if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(revision)) return err("invalidRevision");
  if (state.releases.some((release) => release.revision === revision)) return err("revisionExists");
  const release: ManufacturingRelease = {
    revision,
    status: "draft",
    artifacts: [],
    releasedAt: null,
  };
  return ok({ ...state, releases: [...state.releases, release] });
}

function previewBuild(state: ReleaseFixtureState): ReleaseFixtureResult {
  const revision = state.activeRevision;
  if (
    revision === null ||
    !state.releases.some(
      (release) => release.revision === revision && release.status === "released",
    )
  ) {
    return err("noActiveRelease");
  }

  const number = String(state.builds.length + 1).padStart(3, "0");
  return ok({ ...state, builds: [...state.builds, { id: `BUILD-${number}`, revision }] });
}

function replaceRelease(
  state: ReleaseFixtureState,
  release: ManufacturingRelease,
): ReleaseFixtureState {
  return {
    ...state,
    releases: state.releases.map((previous) =>
      previous.revision === release.revision ? release : previous,
    ),
  };
}

function addArtifact(
  state: ReleaseFixtureState,
  release: ManufacturingRelease,
  kind: ReleaseArtifactKind,
  file: File,
): ReleaseFixtureResult {
  if (file.size === 0) return err("emptyFile");
  if (file.size > releaseFixtureMaxFileBytes) return err("fileTooLarge");
  const extension = requiredExtensions[kind];
  if (extension !== undefined && !file.name.toLowerCase().endsWith(extension)) {
    return err("invalidFileType");
  }

  const artifact: ReleaseArtifact = {
    id: crypto.randomUUID(),
    kind,
    name: file.name,
    sizeBytes: file.size,
    bytes: file,
  };
  return ok(replaceRelease(state, { ...release, artifacts: [...release.artifacts, artifact] }));
}

export function applyReleaseFixture(
  state: ReleaseFixtureState,
  command: ReleaseFixtureCommand,
): ReleaseFixtureResult {
  if (command.type === "previewBuild") return previewBuild(state);
  const revision = normalizeRevision(command.revision);
  if (command.type === "createDraft") return createDraft(state, revision);

  const release = state.releases.find((entry) => entry.revision === revision);
  if (release === undefined) return err("releaseNotFound");
  if (release.status === "released") return err("releaseImmutable");

  switch (command.type) {
    case "addArtifact":
      return addArtifact(state, release, command.kind, command.file);
    case "removeArtifact": {
      const artifacts = release.artifacts.filter((artifact) => artifact.id !== command.artifactId);
      if (artifacts.length === release.artifacts.length) return err("artifactNotFound");
      return ok(replaceRelease(state, { ...release, artifacts }));
    }
    case "approve": {
      if (missingReleaseArtifacts(release).length > 0) return err("missingRequiredArtifacts");
      const approved = replaceRelease(state, {
        ...release,
        status: "released",
        releasedAt: new Date().toISOString(),
      });
      return ok({ ...approved, activeRevision: revision });
    }
  }
}
