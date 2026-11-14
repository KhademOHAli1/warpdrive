// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const { refresh, create } = vi.hoisted(() => ({ refresh: vi.fn(), create: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/identity/actions/teams", () => ({
  createTeamAction: create,
  setTeamMembersAction: vi.fn(),
}));

import { TeamsClient } from "./TeamsClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("restores focus and refreshes the directory on explicit cancel without creating a team", async () => {
  const user = userEvent.setup();
  render(<TeamsClient users={[]} />);
  expect(screen.queryByRole("textbox", { name: "Team name" })).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "Create a team" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Create a team" });
  expect(within(dialog).getByRole("textbox", { name: "Team name" })).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(refresh).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
});
