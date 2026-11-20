import { randomUUID } from "node:crypto";
import {
  CORE_DIAGNOSTIC_CODES,
  type CoreDiagnostic,
  type CoreDiagnosticCode,
  type CoreDiagnosticFacts,
} from "@/contracts/coreDiagnostics";

export type CoreDiagnosticSink = (event: CoreDiagnostic) => void;

const processGeneration = randomUUID();

export const writeCoreDiagnostic: CoreDiagnosticSink = (event) => {
  // One stream preserves process order even when severity changes.
  // biome-ignore lint/suspicious/noConsole: Write the structured runtime diagnostic to host stdout.
  console.info(JSON.stringify(event));
};

export function reportCoreDiagnostic(
  sink: CoreDiagnosticSink,
  code: CoreDiagnosticCode,
  facts: CoreDiagnosticFacts = {},
): void {
  try {
    sink({
      event: "warpdrive.runtime.diagnostic",
      schemaVersion: 1,
      component: "core-api",
      processGeneration,
      observedAtMs: Date.now(),
      code,
      ...CORE_DIAGNOSTIC_CODES[code],
      state: facts.state,
      failure: facts.failure,
      activeRequests: facts.activeRequests,
      admittedBodyBytes: facts.admittedBodyBytes,
      step: facts.step,
    });
  } catch {
    // Diagnostics never influence runtime admission, requests or shutdown.
  }
}
