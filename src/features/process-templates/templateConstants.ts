export const TEMPLATE_MANIFEST_MAX_BYTES = 65_536;
export const TEMPLATE_MAX_STAGES = 32;
export const TEMPLATE_MAX_REQUIREMENTS = 16;
export const POSTGRES_INTEGER_MAX = 2_147_483_647;

// These describe fields already supported by native pipeline/stage services.
// They are manifest vocabulary, not new automation-engine capabilities.
export const STAGE_TEMPLATE_CAPABILITIES = [
  "pipeline.name",
  "stages.ordered",
  "stages.name",
  "stages.rotting-days",
] as const;
