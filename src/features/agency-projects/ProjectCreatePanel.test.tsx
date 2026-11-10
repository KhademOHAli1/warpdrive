// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ProjectCreatePanel } from "./ProjectCreatePanel";

const actions = vi.hoisted(() => ({ options: vi.fn(), create: vi.fn() }));
vi.mock("./actions", () => ({
  agencyProjectOptionsAction: actions.options,
  createAgencyProjectAction: actions.create,
}));
afterEach(cleanup);
test("a confirmed creation admits another fresh intent for the same client", async () => {
  const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  actions.options.mockResolvedValue({
    ok: true,
    value: {
      clients: [{ id: clientId, label: "Synthetic client" }],
      owners: [{ id: actorId, label: "Owner" }],
    },
  });
  actions.create.mockResolvedValue({
    ok: true,
    value: { projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
  });
  render(
    <LocaleProvider locale="en">
      <ProjectCreatePanel actorId={actorId} actorName="Owner" onCreated={vi.fn()} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Client organization" }));
  fireEvent.click(await screen.findByRole("option", { name: "Synthetic client" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
    target: { value: "First project" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create project", exact: true }));
  await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
  fireEvent.click(await screen.findByRole("button", { name: "New project", exact: true }));
  fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
    target: { value: "Second project" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create project", exact: true }));
  await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(2));
  const first = actions.create.mock.calls[0]?.[1] as { intentId: string };
  const second = actions.create.mock.calls[1]?.[1] as { intentId: string };
  expect(second.intentId).not.toBe(first.intentId);
});
