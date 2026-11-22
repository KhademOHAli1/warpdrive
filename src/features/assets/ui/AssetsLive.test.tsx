import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AssetAuditHistoryAccess } from "../audits/history/contracts";
import type { AssetsWorkspace } from "../contracts";
import { AssetsLive } from "./AssetsLive";

const mocks = vi.hoisted(() => ({
  read: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
  register: vi.fn<(props: { auditHistoryAccess?: AssetAuditHistoryAccess }) => null>(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ client: { assets: { audits: { assetHistory: { query: mocks.read } } } } }),
  },
}));
vi.mock("./AssetsWorkspace", () => ({ AssetsRegister: mocks.register }));

const originalWorkspace: AssetsWorkspace = {
  sites: [],
  locations: [],
  categories: [],
  models: [],
  records: [],
};

function mount(initial: AssetsWorkspace, auditsAvailable: boolean) {
  renderToStaticMarkup(
    <AssetsLive
      initial={initial}
      actorId="staff"
      initialAssetId={null}
      initialKitId={null}
      bookingsAvailable={false}
      physicalLabelsAvailable={false}
      auditsAvailable={auditsAvailable}
    />,
  );
  return mocks.register.mock.lastCall?.[0].auditHistoryAccess;
}

describe("live equipment audit history capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("omits the panel on the previous Core and for actors without audit navigation", () => {
    expect(mount(originalWorkspace, true)).toBeUndefined();
    expect(mount({ ...originalWorkspace, auditHistoryAvailable: true }, false)).toBeUndefined();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  test("binds the lazy read to one asset and its abort signal", async () => {
    const read = mount({ ...originalWorkspace, auditHistoryAvailable: true }, true);
    expect(mocks.read).not.toHaveBeenCalled();
    const assetId = "1f07c542-849d-42d9-85c0-56b3ced383fd";
    const signal = new AbortController().signal;
    await expect(read?.(assetId, signal)).resolves.toEqual({ ok: true, entries: [] });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ assetId }, { signal });
  });
});
