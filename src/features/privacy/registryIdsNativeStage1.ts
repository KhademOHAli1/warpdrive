// Current native Board stage boundaries. Existing CRM review IDs bind current source bytes.
// Map/Set deletes are document-memory bookkeeping, not physical or database erasure.
// Access/protocol pins are explicit source reviews even where heuristic discovery has no effect ID.
export const nativeStageIds1: string[] = [
  "derived:src/features/deals/retainedStageMove.ts",
  "log:src/features/deals/nativeStageAction.ts#warn",
  "log:src/features/deals/nativeStageAction.backend.ts#warn",
  "sourceReview:src/features/deals/nativeStage.ts#7aac17e9d845ab9056ca2fe213596673d3af53011ab082c6f9550e29caf680c5",
  "sourceReview:src/features/deals/nativeStageAccess.ts#116695780c5d2e30098b25164f8c1fb2537111a52411b38454deab56e75e0724",
  "sourceReview:src/features/deals/nativeStageAction.ts#69c86f2a8d0bf68c4b058c6af16fcc336c64ef869cbd596f3196d6f4b62c6e6b",
  "sourceReview:src/features/deals/nativeStageAction.backend.ts#0d5535b5fd365937d595a793f2d55f2b946ff2553f0eab2f07ef923086adfdb9",
  "sourceReview:src/features/deals/nativeStageTypes.ts#ecbcaa6eb78fd323c4591c7a2c12cc6875c1f46651061e530a8f5763178db802",
  "sourceReview:src/features/deals/retainedStageMove.ts#3bbaf2095b14609d33f98dedc4dd626ab6e0a735b43c8f14eb87f356f692e189",
  "writer:src/features/deals/nativeStage.ts#update:deals",
  "writer:src/features/deals/retainedStageMove.ts#delete:actorId",
  "writer:src/features/deals/retainedStageMove.ts#delete:listener",
];
