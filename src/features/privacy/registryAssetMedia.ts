import { classifyInventory } from "./registryClassification";

export const assetMediaEntry = classifyInventory(
  [
    "derived:src/features/assets/media/fixture.ts",
    "derived:src/features/assets/media/ui/AssetMedia.tsx",
    "external:src/features/assets/media/webUpload.ts#fetch",
    "objectNamespace:asset-media/",
    "sourceReview:drizzle/0152_asset_media.sql#235002f59a7259599168defa32f4cfcceafe56ef5aa47ecdb6f42465ed60bb87",
    "sourceReview:src/app/api/assets/media/[targetType]/[targetId]/route.backend.ts#d06265a3f9915491bfa4418af563df44c4374f253b361e1061d3f1491da6f90f",
    "sourceReview:src/app/api/assets/media/[targetType]/[targetId]/route.ts#00baab582370418edc6f775e278297b9963eb44df56f0443571860b02d926283",
    "sourceReview:src/features/assets/media/actions.backend.ts#81fdbac5b89daa34805de0ffb3224b79529b57d8de49710111962fe7b61cc897",
    "sourceReview:src/features/assets/media/contracts.ts#ec3f6e7c7395a298a619a346d5b0288e7ac5cbdf8c1d33d0e1147802c9224314",
    "sourceReview:src/features/assets/media/fileRules.ts#808813dad145b9e3d3fed74ef79b2d9d332e4edd510627622a0a3cfd8aa77c41",
    "sourceReview:src/features/assets/media/fixture.ts#d2e1d7a89c2d358edf74583747035ca0c4255c82f42d92671503fa4aa06ce4bb",
    "sourceReview:src/features/assets/media/nativeContracts.ts#aebd0bc8cd204fe160f920106961ffa4c0ae6f61993874d5e3f0d7b3609e3668",
    "sourceReview:src/features/assets/media/repository.ts#b4a1ea04fa09020ead63f73f08fbb07e21aa6e5d882e9e0416c3e56789d5e921",
    "sourceReview:src/features/assets/media/schema.ts#7f42fbb84d6ffdf869bad44651ff258c325e829b8fe367e692cdbfbe3116f4f2",
    "sourceReview:src/features/assets/media/scope.ts#e1f1751d82ef7ddabee359155d06c3a399ce5e0860ed23a032a350bee2c028b0",
    "sourceReview:src/features/assets/media/service.ts#0caa7462e16abb876b387b3abed7927dfebe3f303d1b55c1222148549360bf18",
    "sourceReview:src/features/assets/media/transport.ts#daec228ff9069077c98cadba17f4d6e4022df9d889c7c01720360f3e682030fd",
    "sourceReview:src/features/assets/media/ui/AssetMedia.tsx#43e5fd4a673c0e93c1f6972615cd97497d515eb49a452535fda641e250940cda",
    "sourceReview:src/features/assets/media/ui/ModelMedia.tsx#a733f092bf3d7ef293ab93e300037dc64fdc3b944f5e0dcfcea6ca3cb487fbde",
    "sourceReview:src/features/assets/media/ui/messages.ts#046f17d9d0824e1f5186d3ed00d6c434554c08ed92444c9ff7cc3f43da8ba879",
    "sourceReview:src/features/assets/media/ui/useAssetMedia.ts#b1b1e0c42208448e78604cff14e840d8850700d0f83c45f6c01ddce036a3b21a",
    "sourceReview:src/features/assets/media/webActions.ts#466fceda42808f1a4e7d35420faa57f2103455c60acdccfff9f3817cab94d0fa",
    "sourceReview:src/features/assets/media/webUpload.ts#3fe079ddc68cf22020dcd80dd2cc953d02925e09effcb807e845ea4e2b10e20d",
    "table:asset_media_events",
    "table:asset_media_receipts",
    "table:asset_media_targets",
    "writer:src/features/assets/media/repository.ts#insert:events",
    "writer:src/features/assets/media/repository.ts#insert:receipts",
    "writer:src/features/assets/media/repository.ts#insert:targets",
    "writer:src/features/assets/media/repository.ts#update:targets",
    "writer:src/features/assets/media/service.ts#deleteObject:key",
    "writer:src/features/assets/media/service.ts#execute:sql",
    "writer:src/features/assets/media/service.ts#update:bytes",
  ],
  {
    owner: "site-scoped equipment photos and supporting documents",
    categories: [
      "equipment and model IDs, selected photos and earlier file versions",
      "equipment photos and supporting PDFs, display filenames and attributable file activity",
    ],
    subjectRelation:
      "Media belongs to a site equipment record or model and shows the staff member who uploaded or selected it.",
    purpose:
      "Give an equipment operator a visual reference and authorized access to supporting files and their history.",
    disclosure:
      "Media inherits the register's current site scope. The Asset register and media dialogs are masked from session replay.",
    retention:
      "Previous photos, supporting files and cover history are retained with archived equipment. Native file bytes stay in private storage. Staff deletion clears linked actors from retained history.",
    externalEffects:
      "Core authenticates each equipment photo read, PDF download, cover selection and upload. Private object bytes are checked before release.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
