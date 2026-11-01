// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  members: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/features/identity/actions/teams", () => ({
  updateTeamAction: mocks.update,
  setTeamMembersAction: mocks.members,
  deleteTeamAction: mocks.remove,
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));

import { TeamEditClient } from "./TeamEditClient";

const alice = { id: "alice", name: "Alice", avatarUrl: null };
function setup() {
  return render(
    <TeamEditClient
      teamId="team"
      name="Sales"
      managerId="alice"
      members={[{ userId: "alice", name: "Alice" }]}
      assignableUsers={[alice]}
    />,
  );
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  for (const mock of [mocks.update, mocks.members, mocks.remove])
    mock.mockResolvedValue({ ok: true, value: true });
});
afterEach(cleanup);

describe("Team editor recovery", () => {
  it("disables unchanged Save and lets Cancel discard a draft without a write", () => {
    setup();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Team name")).toHaveValue("Sales");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("retains an update draft after rejected transport", async () => {
    mocks.update.mockRejectedValueOnce(new Error("offline"));
    setup();
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByLabelText("Team name")).toHaveValue("Edited");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("explains partial success and retries the roster without repeating saved details", async () => {
    mocks.members.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
    setup();
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(/Team details were saved, but its members were not/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Team name")).toHaveValue("Edited");
    fireEvent.click(screen.getByRole("button", { name: "Save members" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.members).toHaveBeenCalledTimes(2);
  });

  it("keeps already-saved details when cancelling a failed roster change", async () => {
    mocks.members.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
    setup();
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Team details were saved, but its members were not/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Team name")).toHaveValue("Edited");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it("requires named confirmation before delete and Cancel leaves the team untouched", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^Delete team/ }));
    expect(mocks.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Sales");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Team name")).toHaveValue("Sales");
  });

  it("preserves context after a confirmed deletion fails", async () => {
    mocks.remove.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^Delete team/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete team" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("permission");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Team name")).toHaveValue("Sales");
  });

  it("keeps a current inactive manager identifiable without offering other inactive users", () => {
    render(
      <TeamEditClient
        teamId="team"
        name="Sales"
        managerId="inactive"
        members={[{ userId: "inactive", name: "Former Manager" }]}
        assignableUsers={[alice]}
      />,
    );
    expect(screen.getByLabelText("Manager")).toHaveTextContent("Former Manager");
  });
});
