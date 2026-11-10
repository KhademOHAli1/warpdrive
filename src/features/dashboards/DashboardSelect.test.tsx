// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { DashboardSelect } from "./DashboardSelect";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/pipelines/pipelineEditActions", () => ({ createPipelineAction: vi.fn() }));
afterEach(cleanup);

const pipelines = [
  { id: "p1", name: "Sales" },
  { id: "p2", name: "Partners" },
];

it("offers only the supplied pipelines and Performance with a current indicator", async () => {
  const user = userEvent.setup();
  render(
    <DashboardSelect current={{ kind: "pipeline", pipelineId: "p1" }} pipelines={pipelines} />,
  );
  await user.click(screen.getByRole("button", { name: "Select dashboard: Sales" }));
  expect(screen.getByRole("menu", { name: "Select dashboard" })).toBeInTheDocument();
  const items = screen.getAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["Sales", "Partners", "Performance"]);
  expect(screen.getByRole("menuitem", { name: "Sales" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("menuitem", { name: "Performance" })).toHaveAttribute(
    "href",
    "/dashboard",
  );
});

it.each(["board", "list", "archived"] as const)(
  "retains the %s view for pipeline choices",
  async (pipelineView) => {
    const user = userEvent.setup();
    render(
      <DashboardSelect
        current={{ kind: "pipeline", pipelineId: "p1" }}
        pipelines={pipelines}
        pipelineView={pipelineView}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Sales/ }));
    expect(screen.getByRole("menuitem", { name: "Partners" })).toHaveAttribute(
      "href",
      pipelineView === "board" ? "/pipeline/p2" : `/pipeline/p2/${pipelineView}`,
    );
  },
);

it("provides pipeline destinations from Performance while keeping Performance marked current", async () => {
  const user = userEvent.setup();
  render(<DashboardSelect current={{ kind: "performance" }} pipelines={pipelines} />);
  await user.click(screen.getByRole("button", { name: "Select dashboard: Performance" }));
  expect(screen.getByRole("menuitem", { name: "Sales" })).toHaveAttribute("href", "/pipeline/p1");
  expect(screen.getByRole("menuitem", { name: "Performance" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("keeps Performance reachable with no visible pipelines and no fabricated selection", async () => {
  const user = userEvent.setup();
  render(<DashboardSelect current={null} pipelines={[]} />);
  await user.click(screen.getByRole("button", { name: "Select dashboard: Dashboard" }));
  expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  expect(screen.getByRole("menuitem", { name: "Performance" })).not.toHaveAttribute("aria-current");
  expect(screen.queryByRole("menuitem", { name: /Add/ })).not.toBeInTheDocument();
});

it("keeps authorized pipeline creation and returns focus after dismissing the dialog", async () => {
  const user = userEvent.setup();
  render(
    <DashboardSelect current={{ kind: "performance" }} pipelines={pipelines} canManagePipelines />,
  );
  const trigger = screen.getByRole("button", { name: "Select dashboard: Performance" });
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Add new pipeline" }));
  expect(await screen.findByRole("dialog", { name: "Create pipeline" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

it.each([
  ["de", "Dashboard auswählen: Leistung", "Dashboard auswählen", "Leistung"],
  ["fa", "انتخاب داشبورد: عملکرد", "انتخاب داشبورد", "عملکرد"],
] as const)("localizes dashboard navigation in %s", async (locale, trigger, menu, performance) => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale={locale}>
      <DashboardSelect current={{ kind: "performance" }} pipelines={[]} />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("button", { name: trigger }));
  expect(screen.getByRole("menu", { name: menu })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: performance })).toHaveAttribute("href", "/dashboard");
});
