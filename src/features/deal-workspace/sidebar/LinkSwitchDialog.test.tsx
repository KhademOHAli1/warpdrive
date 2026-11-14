// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DealActionErrorProvider,
  useDealActionError,
} from "@/features/deal-workspace/DealActionErrorProvider";
import { OrgSwitchDialog } from "@/features/deal-workspace/sidebar/OrgSwitchDialog";
import { PersonSwitchDialog } from "@/features/deal-workspace/sidebar/PersonSwitchDialog";

const peopleQuery = vi.hoisted(() =>
  vi.fn<
    (
      _input: undefined,
      _opts: { enabled: boolean },
    ) => {
      data?: { id: string; name: string }[];
      isError?: boolean;
    }
  >(),
);
vi.mock("@/lib/trpc-client", () => ({
  trpc: { contacts: { personOptions: { useQuery: peopleQuery } } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const options = [
  { id: "person-opaque:current", name: "Ann" },
  { id: "person-opaque:chosen", name: "Bob" },
];
afterEach(() => {
  cleanup();
  peopleQuery.mockReset();
});

function choose(picker: string, name: string): void {
  fireEvent.click(screen.getByRole("button", { name: picker }));
  const option = screen
    .getAllByRole("option", { hidden: true })
    .find((element) => element.textContent?.endsWith(name));
  if (!option) throw new Error(`Could not find option ${name}`);
  fireEvent.click(option);
}

function OrgHarness({ onSave }: { onSave: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Open organization
      </button>
      <OrgSwitchDialog
        open={open}
        currentOrgId={options[0]!.id}
        menuTrigger={trigger}
        options={options}
        onOpenChange={setOpen}
        onSave={onSave}
      />
    </>
  );
}

function WriteHarness({
  writes,
  failure,
}: {
  writes: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  failure: string;
}) {
  const report = useDealActionError();
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <OrgSwitchDialog
      open={open}
      currentOrgId={options[0]!.id}
      menuTrigger={trigger}
      options={options}
      onOpenChange={setOpen}
      onSave={async (id, button) => {
        await writes(id);
        if (writes.mock.calls.length === 1) {
          if (failure === "rejection") throw new Error("network unavailable");
          report(undefined, button);
        } else {
          setOpen(false);
        }
      }}
    />
  );
}

describe("deal link switch dialogs", () => {
  it("keeps people loading, unavailable feedback and unchanged-value gating in the Person wrapper", async () => {
    peopleQuery.mockReturnValue({ isError: true });
    const onSave = vi.fn(() => Promise.resolve());
    const view = render(
      <PersonSwitchDialog
        open={false}
        currentPersonId={options[0]!.id}
        menuTrigger={{ current: null }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(peopleQuery).toHaveBeenLastCalledWith(undefined, { enabled: false });
    view.rerender(
      <PersonSwitchDialog
        open
        currentPersonId={options[0]!.id}
        menuTrigger={{ current: null }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(peopleQuery).toHaveBeenLastCalledWith(undefined, { enabled: true });
    expect(screen.getByRole("textbox", { name: "Person" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load people");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    peopleQuery.mockReturnValue({ data: options });
    view.rerender(
      <PersonSwitchDialog
        open
        currentPersonId={options[0]!.id}
        menuTrigger={{ current: null }}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("button", { name: "Person" })).toHaveTextContent("Ann");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    choose("Person", "Bob");
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      return Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      "person-opaque:chosen",
      screen.getByRole("button", { name: "Save" }),
    );
  });

  it("lets Organization save its current ID and resets an abandoned draft on controlled reopening", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<OrgHarness onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Open organization" }));
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      return Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      "person-opaque:current",
      screen.getByRole("button", { name: "Save" }),
    );
    choose("Organization", "Bob");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const open = screen.getByRole("button", { name: "Open organization" });
    await waitFor(() => expect(open).toHaveFocus());
    fireEvent.click(open);
    expect(screen.getByRole("button", { name: "Organization" })).toHaveTextContent("Ann");
  });

  it.each(["result", "rejection"])(
    "retains the exact ID after a failed %s and permits a single retry",
    async (failure) => {
      let settle!: () => void;
      const pending = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const writes = vi.fn<(id: string) => Promise<void>>();
      writes.mockReturnValueOnce(pending).mockResolvedValueOnce(undefined);
      render(
        <DealActionErrorProvider>
          <WriteHarness writes={writes} failure={failure} />
        </DealActionErrorProvider>,
      );
      choose("Organization", "Bob");
      const save = screen.getByRole("button", { name: "Save" });
      fireEvent.click(save);
      fireEvent.click(save);
      expect(save).toBeDisabled();
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "Organization" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
      fireEvent.keyDown(dialog, { key: "Escape" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(dialog).toBeVisible();
      expect(writes).toHaveBeenCalledExactlyOnceWith("person-opaque:chosen");
      await act(() => {
        settle();
        return pending;
      });
      const error = screen.getByRole("dialog", { name: "Couldn't save your change" });
      fireEvent.click(within(error).getByRole("button", { name: "Close" }));
      expect(screen.getByRole("button", { name: "Organization" })).toHaveTextContent("Bob");
      expect(save).toBeEnabled();
      await waitFor(() => expect(save).toHaveFocus());
      fireEvent.click(save);
      expect(writes.mock.calls).toEqual([["person-opaque:chosen"], ["person-opaque:chosen"]]);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    },
  );
});
