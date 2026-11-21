import { z } from "zod";

export const CORE_DIAGNOSTIC_CODES = {
  CORE_STARTING: { phase: "startup", level: "info" },
  CORE_CONFIGURATION_INVALID: { phase: "startup", level: "error" },
  CORE_STARTUP_FAILED: { phase: "startup", level: "error" },
  CORE_STARTUP_TIMEOUT: { phase: "startup", level: "error" },
  CORE_DB_ROLE_REJECTED: { phase: "startup", level: "error" },
  CORE_LISTENER_FAILED: { phase: "startup", level: "error" },
  CORE_READY: { phase: "readiness", level: "info" },
  CORE_READINESS_FAILED: { phase: "readiness", level: "error" },
  CORE_READINESS_TIMEOUT: { phase: "readiness", level: "error" },
  CORE_PRODUCER_FAILED: { phase: "runtime", level: "error" },
  CORE_DATABASE_FAILED: { phase: "runtime", level: "error" },
  CORE_TRANSPORT_FAILED: { phase: "runtime", level: "error" },
  CORE_WEB_IDENTITY_UNAVAILABLE: { phase: "runtime", level: "warn" },
  CORE_DRAINING: { phase: "drain", level: "info" },
  CORE_DRAINED: { phase: "drain", level: "info" },
  CORE_DRAIN_FAILED: { phase: "drain", level: "error" },
  CORE_DRAIN_TIMEOUT: { phase: "drain", level: "error" },
} as const;

export type CoreDiagnosticCode = keyof typeof CORE_DIAGNOSTIC_CODES;

const state = z.enum(["new", "starting", "ready", "draining", "closed", "failed"]);
const failure = z.enum(["startup", "producer", "database", "listener", "health", "transport"]);
export const coreDrainStepSchema = z.enum(["http", "producer", "database", "runtime"]);

export const coreDiagnosticSchema = z
  .strictObject({
    event: z.literal("warpdrive.runtime.diagnostic"),
    schemaVersion: z.literal(1),
    component: z.literal("core-api"),
    processGeneration: z.uuidv4(),
    observedAtMs: z.int().nonnegative(),
    code: z.enum(Object.keys(CORE_DIAGNOSTIC_CODES) as CoreDiagnosticCode[]),
    phase: z.enum(["startup", "readiness", "runtime", "drain"]),
    level: z.enum(["info", "warn", "error"]),
    state: state.optional(),
    failure: failure.optional(),
    activeRequests: z.int().nonnegative().optional(),
    admittedBodyBytes: z.int().nonnegative().optional(),
    step: coreDrainStepSchema.optional(),
  })
  .refine((record) => {
    const expected = CORE_DIAGNOSTIC_CODES[record.code];
    return (
      record.phase === expected.phase &&
      record.level === expected.level &&
      (record.code !== "CORE_READY" || record.state === "ready")
    );
  });

export type CoreDiagnostic = z.infer<typeof coreDiagnosticSchema>;
export type CoreDiagnosticFacts = Pick<
  CoreDiagnostic,
  "state" | "failure" | "activeRequests" | "admittedBodyBytes" | "step"
>;
