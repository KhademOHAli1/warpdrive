import { z } from "zod";

export const CONFIGURED_LOST_REASON = "configured.";
export const LEGACY_LOST_REASON = "legacy-v1.";
export const MISSING_LOST_REASON = "missing";

// The legacy token is a 12-byte nonce, 16-byte authentication tag and 32-byte digest.
// This schema is safe to share with the browser. Text labels are never selectors.
export const lostReasonSelector = z
  .string()
  .regex(
    /^(?:missing|configured\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|legacy-v1\.[A-Za-z0-9_-]{80})$/,
  );
