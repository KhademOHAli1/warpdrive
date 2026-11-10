// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ProjectsScreen } from "./ProjectsScreen";

const actions = vi.hoisted(() => ({ list: vi.fn(), options: vi.fn(), enable: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  listAgencyProjectsAction: actions.list,
  agencyProjectOptionsAction: actions.options,
  enableAgencyProjectsAction: actions.enable,
  readAgencyProjectAction: vi.fn(),
  createAgencyProjectAction: vi.fn(),
  startAgencyProjectAction: vi.fn(),
}));
test("enabled projects loads its native list, while disabled modules expose only an administrator enable action", async () => {
  actions.list.mockResolvedValue({ ok: true, value: { items: [], nextCursor: null } });
  actions.options.mockResolvedValue({ ok: true, value: { clients: [], owners: [] } });
  const props = {
    actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    actorName: "Owner",
    enabled: true,
    canEnable: true,
    canCreate: true,
  };
  const view = render(
    <LocaleProvider locale="en">
      <ProjectsScreen {...props} />
    </LocaleProvider>,
  );
  await waitFor(() => expect(actions.list).toHaveBeenCalled());
  expect(await screen.findByText("No projects match these filters.")).toBeInTheDocument();
  view.rerender(
    <LocaleProvider locale="en">
      <ProjectsScreen {...props} enabled={false} />
    </LocaleProvider>,
  );
  expect(screen.queryByText("No projects match these filters.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enable projects" })).toBeInTheDocument();
  view.rerender(
    <LocaleProvider locale="en">
      <ProjectsScreen {...props} enabled={false} canEnable={false} />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("button", { name: "Enable projects" })).not.toBeInTheDocument();
});
