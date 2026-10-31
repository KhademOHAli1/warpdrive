import type { z } from "zod";
import type { Result } from "@/types/result";
import type { providerInputSchemas } from "./inputSchemas";
import type { ProviderFailure, ProviderOperation } from "./models";
import type { providerOutputSchemas } from "./outputSchemas";

export type { ProviderFailure, ProviderOperation } from "./models";
export type ProviderInput<Operation extends ProviderOperation> = z.infer<
  (typeof providerInputSchemas)[Operation]
>;
export type ProviderOutput<Operation extends ProviderOperation> = z.infer<
  (typeof providerOutputSchemas)[Operation]
>;

export type ProviderOperationSlot<Operation extends ProviderOperation> =
  | { mode: "unsupported" }
  | {
      mode: "supported";
      run: (
        input: ProviderInput<Operation>,
        signal: AbortSignal,
      ) => Promise<Result<ProviderOutput<Operation>, ProviderFailure>>;
    };

// Server-side contracts, not UI DTOs. The caller authenticates/evaluates grant authority first.
// Credentials are opaque broker references; only exchange/refresh return an internal candidate.
export interface ProviderAdapter {
  id: string;
  operations: { [Operation in ProviderOperation]: ProviderOperationSlot<Operation> };
}
