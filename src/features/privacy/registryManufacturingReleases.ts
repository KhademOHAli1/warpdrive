import { classifyInventory } from "./registryClassification";

export const manufacturingReleasesEntry = classifyInventory(
  [
    "derived:src/features/inventory/releases/archive.ts",
    "derived:src/features/inventory/releases/bomCsv.ts",
    "derived:src/features/inventory/releases/service.ts",
    "derived:src/features/projects/access.ts",
    "external:src/features/inventory/releases/ui/ManufacturingReleasesLive.tsx#fetch",
    "sourceReview:drizzle/0128_manufacturing_releases.sql#e0b408d1db30f5ca142f3c96efca7a8747fbe759a8f2c4ca8ee8da2f59157ac1",
    "sourceReview:src/app/api/inventory/releases/[releaseId]/files/[artifactId]/route.backend.ts#450adc80dfc8fd2855ac4052d36286414bae8a29987559fd6bd03b81d5971117",
    "sourceReview:src/features/inventory/releases/access.ts#d72915a98528345959945d5a76d00259f024e6fa6db21b6e969e3b9590c12e97",
    "sourceReview:src/features/inventory/releases/actions.backend.ts#760516ffc4ad6704d062fa0919e41b68cd80c9782bc2819ff43cdac7fa4aabaa",
    "sourceReview:src/features/inventory/releases/archive.ts#9e554c9858c5dc8d0b284ba6723d232d20734718f54211b1f4771855f2a945a3",
    "sourceReview:src/features/inventory/releases/artifacts.ts#d5b3fce21166df7a6996564359fd6c9a81bf623c079a5ea639f590a1fccb657b",
    "sourceReview:src/features/inventory/releases/bomCsv.ts#46636c3c475a49047f62bd366e96c25b30cbab9c87fff6bfd51810e5bec558a9",
    "sourceReview:src/features/inventory/releases/router.ts#9da7218581df4cd243078446b33b761533ce1c0e4c2daaeee776599339b0b703",
    "sourceReview:src/features/inventory/releases/schema.ts#32f5105b786a946cc02b40f3693592adb34e0df4b61a3282352461dc1584bc9a",
    "sourceReview:src/features/inventory/releases/service.ts#a174db1be1eae8ae82cda310a44d1ad6414e4c6a220e25273c5dfab091cd35e4",
    "sourceReview:src/features/inventory/releases/ui/ManufacturingReleasesLive.tsx#2d3d0f4195bcda9b5b569f0f62b6c229051eb1cc8837a7c35b22c177f8e583d7",
    "sourceReview:src/features/inventory/releases/webReads.ts#158207f9b79cf23779ddb9ff5b25933dce23a4d7799cec878cd236bf06527b3d",
    "table:inventory_build_releases",
    "table:inventory_product_releases",
    "table:inventory_release_artifacts",
    "table:inventory_release_grants",
    "writer:src/features/inventory/releases/artifacts.ts#delete:inventoryReleaseArtifacts",
    "writer:src/features/inventory/releases/artifacts.ts#deleteObject:key",
    "writer:src/features/inventory/releases/artifacts.ts#insert:inventoryReleaseArtifacts",
    "writer:src/features/inventory/releases/artifacts.ts#presignPost:objectKey",
    "writer:src/features/inventory/releases/artifacts.ts#update:bytes",
    "writer:src/features/inventory/releases/artifacts.ts#update:inventoryReleaseArtifacts",
    "writer:src/features/inventory/releases/router.ts#query:dynamic",
    "writer:src/features/inventory/releases/service.ts#delete:inventoryReleaseGrants",
    "writer:src/features/inventory/releases/service.ts#insert:inventoryProductReleases",
    "writer:src/features/inventory/releases/service.ts#insert:inventoryReleaseGrants",
    "writer:src/features/inventory/releases/service.ts#update:dynamic",
    "writer:src/features/inventory/releases/service.ts#update:inventoryItems",
    "writer:src/features/inventory/releases/service.ts#update:inventoryProductReleases",
    "writer:src/features/inventory/releases/webReads.ts#query:dynamic",
    "writer:src/features/inventory/service.ts#insert:inventoryBuildReleases",
  ],
  {
    owner: "industrial manufacturing releases",
    categories: [
      "engineering artifact names, contents, and integrity metadata",
      "approved manufacturing BOM snapshots and production order and task references",
      "staff permissions, draft creators, upload actors and approval history",
    ],
    subjectRelation:
      "Staff identities document engineering file handling and approvals. Production package access is checked using the selected order and native project assignment scope.",
    purpose:
      "Preserve the engineering files and approved BOM that apply to an individual manufacturing build.",
    disclosure:
      "Accepted staff require a product-scoped engineering grant or administration access. Production staff may read the approved release pinned to their authorized project build. The download route rechecks authority and serves verified attachment bytes.",
    retention:
      "PostgreSQL retains immutable released metadata, approval history and build pins. The configured private object store retains sealed files. Incomplete uploads and private orphan keys are separate from the approved manifest.",
    externalEffects:
      "The browser sends files to the configured object store under a bounded signed upload. Core validates and seals the bytes, verifies SHA-256 at approval and download, and publishes a product-scoped manifest. The native Projects projection carries an opaque build link only for staff.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
