export const QUALIFICATION_MAX_BYTES = 65_536;
export const QUALIFICATION_MAX_CRITERIA = 16;
export const QUALIFICATION_MAX_REFERENCES = 6;
export const QUALIFICATION_MAX_VERSION = 2_147_483_647;

export const QUALIFICATION_UNAVAILABLE_CAPABILITIES = Object.freeze({
  installation: "unavailable",
  persistedSelection: "unavailable",
  evidenceWrite: "unavailable",
  scoring: "unavailable",
  stagePolicy: "unavailable",
  effects: "unavailable",
} as const);
