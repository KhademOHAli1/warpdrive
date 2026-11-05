import { AppError, ERROR_IDS } from "@/constants/errorIds";
export type StripeErrorCode =
  | "invalid_config"
  | "invalid_input"
  | "timeout"
  | "unavailable"
  | "http_error"
  | "invalid_response"
  | "mode_mismatch"
  | "invalid_signature";

// Never attach provider bodies, fetch causes, customer details or credentials.
const STRIPE_ERROR_IDS = {
  invalid_config: ERROR_IDS.BILLING_PROVIDER_CONFIGURATION,
  invalid_input: ERROR_IDS.BILLING_INPUT_INVALID,
  timeout: ERROR_IDS.BILLING_PROVIDER_TIMEOUT,
  unavailable: ERROR_IDS.BILLING_PROVIDER_UNAVAILABLE,
  http_error: ERROR_IDS.BILLING_PROVIDER_HTTP,
  invalid_response: ERROR_IDS.BILLING_PROVIDER_RESPONSE,
  mode_mismatch: ERROR_IDS.BILLING_PROVIDER_MODE,
  invalid_signature: ERROR_IDS.BILLING_SIGNATURE,
} as const;
export class StripeProviderError extends AppError {
  readonly code: StripeErrorCode;
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(code: StripeErrorCode, status?: number, requestId?: string) {
    super(STRIPE_ERROR_IDS[code], `Stripe billing request failed (${code}).`);
    this.name = "StripeProviderError";
    this.code = code;
    this.status = status;
    this.requestId = requestId?.match(/^req_[A-Za-z0-9]{1,200}$/)?.[0];
  }
}
