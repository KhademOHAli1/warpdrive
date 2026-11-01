// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Created = { ok: true; value: { id: string } } | { ok: false; error: string };
const mocks = vi.hoisted(() => ({ create: vi.fn(), members: vi.fn() }));
vi.mock("@/features/identity/actions/teams", () => ({
  createTeamAction: mocks.create,
  setTeamMembersAction: mocks.members,
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { CreateTeamForm } from "./CreateTeamForm";

const users = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
];
beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ ok: true, value: { id: "team-created" } });
  mocks.members.mockReset().mockResolvedValue({ ok: true, value: true });
});
afterEach(cleanup);
function enter() {
  fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Sales" } });
}
function chooseMember() {
  fireEvent.click(screen.getByLabelText("Members"));
  fireEvent.click(screen.getByRole("option", { name: /Bob/ }));
}

describe("Team creation recovery", () => {
  it("retains an uncertain creation draft and prevents blind resubmission", async () => {
    mocks.create.mockRejectedValueOnce(new Error("offline"));
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    render(<CreateTeamForm users={users} onCreated={onCreated} onCancel={onCancel} />);
    enter();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not confirm whether the team was created",
    );
    expect(screen.getByLabelText("Team name")).toHaveValue("Sales");
    expect(screen.getByLabelText("Team name")).toBeDisabled();
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByLabelText("Team name").closest("form") as HTMLFormElement);
    expect(mocks.create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it.each(["result", "transport"])(
    "retries only membership after a partial create (%s failure)",
    async (failure) => {
      if (failure === "result")
        mocks.members.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
      else mocks.members.mockRejectedValueOnce(new Error("offline"));
      const onCreated = vi.fn();
      render(<CreateTeamForm users={users} onCreated={onCreated} />);
      enter();
      chooseMember();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      expect(
        await screen.findByText(/team was created, but its members were not saved/i),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Team name")).toHaveValue("Sales");
      expect(screen.getByLabelText("Team name")).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Save members" }));
      await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.members).toHaveBeenCalledTimes(2);
      expect(mocks.members).toHaveBeenLastCalledWith("csrf", {
        teamId: "team-created",
        userIds: ["bob"],
      });
    },
  );

  it("locks duplicate submits and all selectors while creation is pending", async () => {
    let resolve: (result: Created) => void = () => {};
    const pending = new Promise<Created>((done) => {
      resolve = done;
    });
    mocks.create.mockReturnValueOnce(pending);
    render(<CreateTeamForm users={users} onCreated={vi.fn()} />);
    enter();
    const create = screen.getByRole("button", { name: "Create" });
    const form = create.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Manager")).toBeDisabled();
    expect(screen.getByLabelText("Members")).toBeDisabled();
    await act(async () => {
      resolve({ ok: true, value: { id: "new" } });
      await pending;
    });
  });

  it("offers an explicit cancel without writing a team", () => {
    const cancel = vi.fn();
    render(<CreateTeamForm users={users} onCreated={vi.fn()} onCancel={cancel} />);
    enter();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
