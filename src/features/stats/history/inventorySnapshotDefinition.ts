export const INVENTORY_SNAPSHOT_DEFINITION_VERSION = 1;

// Pin the v1 descriptor used for stored snapshots. A later dictionary release must not
// invalidate this definition; publish a separate version if the calculation changes.
export const INVENTORY_SNAPSHOT_DEFINITION = {
  id: "current-pipeline-inventory",
  metricDictionaryVersion: 1,
  source: "authorized-live-deals-with-capture-tip",
  factMembership: "active-deals-in-selected-currency",
  stockStatus: "open",
  cutoffBasis: "native-database-snapshot",
  absentKey: "no-physical-absence-inference",
} as const;
