// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { workCatalog } from "../catalog";
import type { Overview, Preview } from "../contracts";
import { PresetInstaller } from "./PresetInstaller";

const ids = {
  scope: "11111111-1111-4111-8111-111111111111",
  receipt: "22222222-2222-4222-8222-222222222222",
  request: "33333333-3333-4333-8333-333333333333",
  type: "44444444-4444-4444-8444-444444444444",
};
const catalog = workCatalog("en").filter((preset) => preset.id === "vehicle_repair");
const data: Overview = {
  workspaceScope: ids.scope,
  revision: 0,
  preferences: {
    workTypes: [],
    primaryWorkType: null,
    modules: [],
    primaryGoal: "",
    deliveryModels: [],
    customerTypes: [],
  },
  catalog,
  workTypes: [],
  installations: [],
  permissions: {
    manageProfile: true,
    apply: true,
    view: true,
    create: true,
    change: true,
    manage: true,
  },
};
const preset = catalog[0];
function reply(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
}
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
it("reviews the server's exact selected proposal before creating resources and retains the receipt", async () => {
  if (!preset) throw new TypeError("Fixture missing vehicle repair preset");
  const preview: Preview = {
    fingerprint: "a".repeat(64),
    presetId: "vehicle_repair",
    presetVersion: 1,
    expectedRevision: 0,
    locale: "en",
    selection: { sales: true, delivery: true, dealFields: true, activityTypes: true },
    salesName: preset.sales.name,
    deliveryName: preset.delivery.name,
    operations: [
      {
        kind: "work_type",
        key: "vehicle_repair",
        name: preset.delivery.name,
        disposition: "create",
      },
    ],
    conflicts: [],
  };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(
      reply({
        installation: {
          id: ids.receipt,
          requestId: ids.request,
          presetId: "vehicle_repair",
          presetVersion: 1,
          createdAt: "2026-11-05T10:00:00Z",
          undoneAt: null,
          resources: [{ kind: "work_type", key: "vehicle_repair", id: ids.type, created: true }],
        },
        revision: 1,
        workTypes: [],
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const changed = vi.fn();
  render(<PresetInstaller data={data} actorId={ids.request} changed={changed} />);
  fireEvent.click(screen.getByText(`${preset.name} · Version 1`));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Confirm and install" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preview setup" }));
  expect(await screen.findByText("Review the proposed changes")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Confirm and install" }));
  expect(await screen.findByText("Installation history")).toBeInTheDocument();
  expect(changed).toHaveBeenCalledTimes(1);
  const body = fetchMock.mock.calls[1]?.[1]?.body;
  expect(typeof body).toBe("string");
  const payload: unknown = JSON.parse(typeof body === "string" ? body : "null");
  expect(payload).toMatchObject({ action: "apply", preview });
});
