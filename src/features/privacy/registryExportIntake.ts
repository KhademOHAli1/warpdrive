import { classifyInventory } from "./registryClassification";

export const exportIntakeEntry = classifyInventory(
  [
    "derived:src/features/inventory/releases/intake/fixture.ts",
    "derived:src/features/inventory/releases/intake/manifest.ts",
    "derived:src/features/inventory/releases/intake/ui/ExportBundleDialog.tsx",
    "derived:src/features/inventory/releases/intake/ui/ExportIntakePanel.tsx",
    "derived:src/features/inventory/releases/ui/ManufacturingReleasesFixture.tsx",
    "sourceReview:src/features/inventory/releases/intake/contracts.ts#eab8a9bb37ad9a0bb11ce4bbdb19994c011b664335063b0389acf8506e2e2ae6",
    "sourceReview:src/features/inventory/releases/intake/fixture.ts#6b34f88c6296dcaac62d8b8e0e1e8ff4bfa764985a517fcfeedf4006c2cd52ae",
    "sourceReview:src/features/inventory/releases/intake/manifest.ts#5e2ab89c715d8c69d1532f5d58220526bee98f2aa7d2bcc4f8c89bee6d89a6ee",
    "sourceReview:src/features/inventory/releases/intake/ui/ExportBundleDialog.tsx#07fb91b6fdbc1457289e8cb0bfaad6311bf47bf27dd0a15c0ca78304553ccb85",
    "sourceReview:src/features/inventory/releases/intake/ui/ExportIntakePanel.tsx#b6390b5f5811da9a10f012703bc4675a7d14e3427758ae2592b0fa00b90f466a",
    "sourceReview:src/features/inventory/releases/intake/ui/messages.ts#fc18fca24fe8ef80b46ad5a4d933274759661ba0d9bda672d0e0c57f20d43647",
    "writer:src/features/inventory/releases/intake/manifest.ts#delete:dynamic",
    "writer:src/features/inventory/releases/intake/ui/ExportBundleDialog.tsx#send:none",
    "writer:src/features/inventory/releases/intake/ui/ExportIntakePanel.tsx#delete:key",
    "writer:src/features/inventory/releases/intake/ui/ExportIntakePanel.tsx#send:requestId",
  ],
  {
    owner: "engineering export intake",
    categories: [
      "exact product and draft release identity",
      "exporter version, file roles and integrity digests",
      "private staged files and scoped recovery receipts",
    ],
    subjectRelation:
      "The existing release editor submits design exports. Retained attempts attribute each accepted or failed processing run.",
    purpose:
      "Validate a multi-file engineering export and attach it to the exact manufacturing release draft.",
    disclosure:
      "Require current access to the exact release and draft editing authority for upload and retry. Keep file bytes in private storage under the authorized workflow.",
    retention:
      "Disposable file manifests and job receipts stay in the browser fixture and reset on reload.",
    externalEffects:
      "The fixture can preview files for the exact draft and simulate a retry. All effects are local to the disposable fixture.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
