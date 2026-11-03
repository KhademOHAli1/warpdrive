import { beforeEach, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  csrf: vi.fn(),
  context: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  duplicate: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: deps.csrf }));
vi.mock("@/server/trpc/context", () => ({ createContext: deps.context }));
vi.mock("./lifecycle", () => ({
  archiveWorkflow: deps.archive,
  unarchiveWorkflow: deps.unarchive,
  duplicateWorkflow: deps.duplicate,
  restoreWorkflowDraft: deps.restore,
}));

import {
  archiveWorkflowAction,
  duplicateWorkflowAction,
  restoreWorkflowDraftAction,
  unarchiveWorkflowAction,
} from "./actions";

beforeEach(() => vi.resetAllMocks());

const commands = [
  ["archive", archiveWorkflowAction, deps.archive],
  ["unarchive", unarchiveWorkflowAction, deps.unarchive],
  ["duplicate", duplicateWorkflowAction, deps.duplicate],
  ["restore", restoreWorkflowDraftAction, deps.restore],
] as const;

it.each(commands)(
  "denies %s before reading context when CSRF fails",
  async (_, action, service) => {
    deps.csrf.mockResolvedValue({ ok: false, error: "csrf" });
    expect(await action({}, "invalid")).toEqual({ ok: false, error: "E_WORKFLOW_001" });
    expect(deps.context).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  },
);

it.each(commands)(
  "denies %s when the current authenticated actor is absent",
  async (_, action, service) => {
    deps.csrf.mockResolvedValue({ ok: true });
    deps.context.mockResolvedValue({ actor: null });
    expect(await action({}, "token")).toEqual({ ok: false, error: "E_WORKFLOW_001" });
    expect(service).not.toHaveBeenCalled();
  },
);

it.each(commands)(
  "passes %s to its service with server actor and a bounded signal",
  async (_, action, service) => {
    const db = {};
    const actor = { id: crypto.randomUUID() };
    const input = { id: crypto.randomUUID(), revision: 2 };
    deps.csrf.mockResolvedValue({ ok: true });
    deps.context.mockResolvedValue({ db, actor });
    const conflict = { ok: false, error: "E_WORKFLOW_003" };
    service.mockResolvedValue(conflict);
    expect(await action(input, "token")).toBe(conflict);
    expect(service).toHaveBeenCalledWith(db, actor, input, expect.any(AbortSignal));
  },
);
