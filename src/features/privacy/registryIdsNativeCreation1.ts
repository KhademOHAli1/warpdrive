// Exact reviewed native-create receipt and transient client boundaries.
// Map/Set deletion identifiers describe in-memory bookkeeping, not database erasure.
export const nativeCreationIds1: string[] = [
  "derived:src/features/deals/nativeCreateIntentV1.ts",
  "derived:src/features/deals/retainedCreation.ts",
  "sourceReview:src/db/schema/dealCreateOperations.ts#819ee383217e06003065a6cf294b925500a734d1867061ffa31261b038f1da04",
  "sourceReview:src/features/deals/nativeCreate.ts#60346781267ada154c3bd7e57860cf30f0c980e4357d3833f649d1b30dc6daf0",
  "sourceReview:src/features/deals/nativeCreateInputs.ts#b1cde2c5cbbdb49cebb8cde125a4db69f5c0347d46e82442ae488852d3e1402d",
  "sourceReview:src/features/deals/nativeCreateIntentV1.ts#0c37ff5255672d8d2d9a6f4d2d0e109bcce69f3663049303a41e9aaba41aafb1",
  "sourceReview:src/features/deals/nativeCreatedRead.ts#294a0ae82377708b551c0ab8dea0f2b0d9c8a7a2699e093ca8182b7fc3954839",
  "sourceReview:src/features/deals/retainedCreation.ts#da98a9bf30e1a8f6d7ae8194c504f032ca8efb7903ece4b3538fa0cc7591f10f",
  "table:deal_create_operations",
  "writer:src/features/deals/nativeCreate.ts#execute:sql",
  "writer:src/features/deals/nativeCreate.ts#insert:dealCreateOperations",
  "writer:src/features/deals/nativeCreate.ts#update:dynamic",
  "writer:src/features/deals/nativeCreateInputs.ts#execute:sql",
  "writer:src/features/deals/nativeCreateIntentV1.ts#delete:current",
  "writer:src/features/deals/nativeCreatedRead.ts#execute:sql",
  "writer:src/features/deals/retainedCreation.ts#delete:actorId",
  "writer:src/features/deals/retainedCreation.ts#delete:dynamic",
  "writer:src/features/deals/retainedCreation.ts#delete:listener",
];
