// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/identity/actions/teams", () => ({
  createTeamAction: vi.fn(),
  setTeamMembersAction: vi.fn(),
}));

import { TeamsClient } from "./TeamsClient";

afterEach(cleanup);
it("keeps creation focused behind a task action and returns to the directory on cancel", () => {
  render(<TeamsClient users={[]} />);
  expect(screen.queryByRole("textbox", { name: "Team name" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create a team" }));
  const dialog = screen.getByRole("dialog", { name: "Create a team" });
  expect(within(dialog).getByRole("textbox", { name: "Team name" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
