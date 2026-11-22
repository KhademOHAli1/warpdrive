// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type * as NextNavigation from "next/navigation";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import type { EquipmentAuditAccess } from "@/features/assets/audits/contracts";
import {
  assetAuditHistoryFixture,
  assetAuditHistoryFixtureId,
} from "@/features/assets/audits/history/fixture";
import { projectAuditDetail, projectAuditWorkspace } from "@/features/assets/audits/projection";
import { EquipmentAuditsWorkspace } from "@/features/assets/audits/ui/EquipmentAuditsWorkspace";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import Page from "./page";

const mocks = vi.hoisted(() => ({
  actor: {
    id: "0181aecb-b045-49a9-9762-fd6a32b79877",
    name: "Workspace operator",
    type: "admin",
    isActive: true,
    projectsGuestOnly: false,
  },
}));
vi.mock("@/features/inventory/availability", () => ({ inventoryFixturesEnabled: () => true }));
vi.mock("@/frontend/context", () => ({
  createContext: () => Promise.resolve({ actor: mocks.actor, projectGuest: null }),
  getBootstrap: () => Promise.resolve({ shell: null }),
}));
vi.mock("@/frontend/trpc", () => ({ coreClient: vi.fn() }));
vi.mock("next/navigation", async (load) => ({
  ...(await load<typeof NextNavigation>()),
  notFound: () => {
    throw new Error("Audit unavailable");
  },
}));

const title = "Instrument corner recount";
function page(auditId?: string | string[]) {
  return Page({ searchParams: Promise.resolve({ auditId }) });
}

beforeEach(() => {
  mocks.actor.type = "admin";
});
afterEach(cleanup);

it("opens and focuses the archived audit from an accepted case-normalized ID", async () => {
  render(
    <LocaleProvider locale="en">
      {await page(assetAuditHistoryFixtureId.toUpperCase())}
    </LocaleProvider>,
  );
  const heading = await screen.findByRole("heading", { name: title });
  expect(heading).toHaveFocus();
  expect(heading.closest("[data-audit-detail]")).toHaveAttribute(
    "data-audit-detail",
    assetAuditHistoryFixtureId,
  );
  expect(
    heading.closest("[data-audit-detail]")?.querySelector("[data-audit-status='archived']"),
  ).toBeInTheDocument();
});

it("rejects invalid, duplicate, foreign and unauthorized fixture audit links", async () => {
  for (const auditId of [
    [assetAuditHistoryFixtureId, assetAuditHistoryFixtureId],
    "audit",
    crypto.randomUUID(),
  ]) {
    await expect(page(auditId)).rejects.toThrow("Audit unavailable");
  }
  mocks.actor.type = "regular";
  await expect(page(assetAuditHistoryFixtureId)).rejects.toThrow("Audit unavailable");
});

it("drops linked audit detail on scope loss without substituting an authorized neighboring audit", async () => {
  const { state, manager } = assetAuditHistoryFixture();
  const initial = projectAuditWorkspace(state, manager);
  const [linked] = initial.audits;
  assert(linked !== undefined);
  const nearby = {
    ...linked,
    id: "da9752d5-d176-4b38-b03b-350504611cac",
    title: "Neighboring audit",
  };
  const read = vi.fn<EquipmentAuditAccess["read"]>((id) =>
    Promise.resolve(projectAuditDetail(state, manager, id)),
  );
  const access: EquipmentAuditAccess = {
    read,
    submit: () => Promise.resolve({ ok: false, error: "unavailable" }),
    attach: () => Promise.resolve({ ok: false, error: "unavailable" }),
    lookup: () => Promise.resolve({ ok: false, error: "unavailable" }),
  };
  const workspace = (present: boolean) => (
    <LocaleProvider locale="en">
      <EquipmentAuditsWorkspace
        initial={{
          ...initial,
          readAt: present ? 1 : 2,
          audits: present ? [linked, nearby] : [nearby],
        }}
        access={access}
        initialAuditId={linked.id}
        fixture={false}
      />
    </LocaleProvider>
  );
  const view = render(workspace(true));
  expect(await screen.findByRole("heading", { name: title })).toHaveFocus();
  view.rerender(workspace(false));
  expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: nearby.title })).not.toBeInTheDocument();
  expect(read).not.toHaveBeenCalledWith(nearby.id);
});
