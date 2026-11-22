/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AssetAuditHistoryAccess } from "../audits/history/contracts";
import type { AssetsWorkspace } from "../contracts";
import { AssetsLive } from "./AssetsLive";

const mocks = vi.hoisted(() => {
  const read = vi.fn().mockResolvedValue({ ok: true, entries: [] });
  return {
    read,
    client: { assets: { audits: { assetHistory: { query: read } } } },
    register: vi.fn<(props: { auditHistoryAccess?: AssetAuditHistoryAccess }) => null>(),
  };
});

vi.mock("@/lib/trpc-client", () => ({
  trpc: { useUtils: () => ({ client: mocks.client }) },
}));
vi.mock("./AssetsWorkspace", () => ({ AssetsRegister: mocks.register }));

const originalWorkspace: AssetsWorkspace = {
  sites: [],
  locations: [],
  categories: [],
  models: [],
  records: [],
};

function live(initial: AssetsWorkspace, auditsAvailable: boolean) {
  return (
    <AssetsLive
      initial={initial}
      actorId="staff"
      initialAssetId={null}
      initialKitId={null}
      bookingsAvailable={false}
      physicalLabelsAvailable={false}
      auditsAvailable={auditsAvailable}
    />
  );
}

function mount(initial: AssetsWorkspace, auditsAvailable: boolean) {
  renderToStaticMarkup(live(initial, auditsAvailable));
  return mocks.register.mock.lastCall?.[0].auditHistoryAccess;
}

describe("live equipment audit history capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

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

  test("refreshes the lazy read on a new server snapshot for the same actor", () => {
    const supported = { ...originalWorkspace, auditHistoryAvailable: true as const };
    const view = render(live(supported, true));
    const first = mocks.register.mock.lastCall?.[0].auditHistoryAccess;
    expect(first).toBeTypeOf("function");
    view.rerender(live(supported, true));
    expect(mocks.register.mock.lastCall?.[0].auditHistoryAccess).toBe(first);
    view.rerender(live({ ...supported }, true));
    expect(mocks.register.mock.lastCall?.[0].auditHistoryAccess).not.toBe(first);
  });
});
