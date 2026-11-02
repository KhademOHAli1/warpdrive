import { vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { ok, type Result } from "@/types/result";
import type {
  createOwnPrivacyRequestAction,
  readOwnPrivacyRequestAction,
  verifyOwnPrivacyRequestAction,
} from "../../requestActions";
import type { claimPrivacyCaseAction, listPrivacyIntakeQueueAction } from "../../reviewerActions";
import type { loadOwnPrivacySecurity } from "../loadOwnPrivacySecurity";

const mocks = vi.hoisted(() => ({
  create: vi.fn<typeof createOwnPrivacyRequestAction>(),
  read: vi.fn<typeof readOwnPrivacyRequestAction>(),
  verify: vi.fn<typeof verifyOwnPrivacyRequestAction>(),
  list: vi.fn<typeof listPrivacyIntakeQueueAction>(),
  claim: vi.fn<typeof claimPrivacyCaseAction>(),
  loadSecurity: vi.fn<typeof loadOwnPrivacySecurity>(),
  workflow: vi.fn(),
}));

export { mocks };

vi.mock("../../requestActions", () => ({
  createOwnPrivacyRequestAction: mocks.create,
  readOwnPrivacyRequestAction: mocks.read,
  verifyOwnPrivacyRequestAction: mocks.verify,
}));
vi.mock("../../reviewerActions", () => ({
  listPrivacyIntakeQueueAction: mocks.list,
  claimPrivacyCaseAction: mocks.claim,
}));
vi.mock("../loadOwnPrivacySecurity", () => ({ loadOwnPrivacySecurity: mocks.loadSecurity }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/auth/ui/workflowRequest", () => ({ workflowAction: mocks.workflow }));
vi.mock("@/features/auth/ui/useAccountStatus", () => ({
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: false } }),
}));

// UI/framework/action boundary fixtures only. No database module or authorization query is mocked.
export const USER = "00000000-0000-4000-8000-000000000001";
export const CASE = "00000000-0000-4000-8000-000000000031";
export const RECEIPT = "00000000-0000-4000-8000-000000000041";
export const LATE = "00000000-0000-4000-8000-000000000099";
export const PRIVATE_DRAFT = "PRIVATE-SAME-ACCOUNT-EMAIL-VERIFICATION-DRAFT";
export const VERIFY_EMAIL = "Verify your email address before continuing.";
export const CLAIM_RECORDED =
  "Assignment receipt recorded. Refresh the queue to check current availability.";
export const OWN_RECORDED =
  "Your own-account confirmation was recorded. This does not approve a response or data change.";
export const security: SecurityStatus = {
  authenticated: true,
  user: { id: USER, name: "Synthetic requester", email: "requester@example.test", isAdmin: false },
  emailVerified: true,
  fresh: true,
  hasPassword: true,
  twoFactorEnabled: false,
  needsMfa: false,
  needsEnrollment: false,
  authMethod: "password",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 12, freshMinutes: 5 },
  accounts: [],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: false,
  audit: [],
};
export const unverified: SecurityStatus = { ...security, emailVerified: false, fresh: true };
export type RefreshSecurity = (
  signal: AbortSignal,
) => Promise<Result<SecurityStatus | null, "unavailable">>;
type ReadResult = Awaited<ReturnType<typeof readOwnPrivacyRequestAction>>;
type OwnCase = Extract<ReadResult, { ok: true }>["value"];
type CreateResult = Awaited<ReturnType<typeof createOwnPrivacyRequestAction>>;
type OwnReceipt = Extract<CreateResult, { ok: true }>["value"];
type QueueResult = Awaited<ReturnType<typeof listPrivacyIntakeQueueAction>>;
type Queue = Extract<QueueResult, { ok: true }>["value"];
export const ownCase: OwnCase = {
  id: CASE,
  kind: "access",
  status: "received",
  version: 3,
  receivedAt: new Date("2026-03-21T00:30:00Z"),
  dueAt: null,
};
export const receipt: OwnReceipt = {
  id: RECEIPT,
  kind: "access",
  status: "received",
  version: 1,
  receivedAt: new Date("2026-03-21T00:30:00Z"),
};
export const queue: Queue = {
  items: [{ ...ownCase, version: 7 }],
  nextAfterId: null,
  snapshot: "live_unassigned",
};

export function refreshStub() {
  return vi.fn<RefreshSecurity>().mockResolvedValue(ok(security));
}
export function resetEmailVerificationUi() {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(ok(receipt));
  mocks.read.mockResolvedValue(ok(ownCase));
  mocks.verify.mockResolvedValue(ok({ ...ownCase, version: 4 }));
  mocks.list.mockResolvedValue(ok(queue));
  mocks.claim.mockResolvedValue(ok({ id: CASE, version: 8, status: "received" }));
  mocks.loadSecurity.mockResolvedValue(ok(security));
  mocks.workflow.mockResolvedValue({ data: {}, error: null });
}
export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
