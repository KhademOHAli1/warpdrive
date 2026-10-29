// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { create, edit } = vi.hoisted(() => ({
  create: vi.fn(() => Promise.resolve({ ok: true, value: { id: "a" } })),
  edit: vi.fn(() => Promise.resolve({ ok: true, value: { id: "a" } })),
}));
vi.mock("./actions", () => ({ createActivityAction: create, editActivityAction: edit }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("./useInvalidateActivityLists", () => ({
  useInvalidateActivityLists: () => async () => {},
}));
vi.mock("./ActivityDatePicker", () => ({
  ActivityDatePicker: ({
    ariaLabel,
    value,
    onChange,
  }: {
    ariaLabel: string;
    value: string | null;
    onChange: (v: string | null) => void;
  }) => (
    <input aria-label={ariaLabel} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/ui/TimePicker", () => ({
  TimePicker: ({
    ariaLabel,
    value,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    activities: {
      listTypes: { useQuery: () => ({ data: [{ id: "t", key: "call", name: "Call" }] }) },
    },
    contacts: {
      listPeople: { useQuery: () => ({ data: { rows: [] } }) },
      listOrgs: { useQuery: () => ({ data: { rows: [] } }) },
    },
  },
}));

import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ActivityEditModal } from "./ActivityEditModal";
import { AddActivityModal } from "./AddActivityModal";
import { activitiesMessagesForLocale } from "./activitiesMessages";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("activity form timezone contract", () => {
  it("creates a Persian all-day civil date in Tehran and freezes its draft zone when preferences change", async () => {
    const S = activitiesMessagesForLocale("fa");
    const modal = <AddActivityModal defaultDate="2026-03-21" onClose={() => {}} />;
    const view = render(
      <LocaleProvider locale="fa" timeZone="Asia/Tehran">
        {modal}
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText(S.subject), { target: { value: "تماس نوروزی" } });
    view.rerender(
      <LocaleProvider locale="fa" timeZone="Pacific/Honolulu">
        {modal}
      </LocaleProvider>,
    );
    expect(screen.getByText(/Asia\/Tehran/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          dueDate: "2026-03-21",
          dueAt: "2026-03-20T20:30:00.000Z",
          allDay: true,
        }),
        "csrf",
      ),
    );
  });
  it("rejects a nonexistent Berlin clock time with localized feedback before creating", async () => {
    const S = activitiesMessagesForLocale("fa");
    render(
      <LocaleProvider locale="fa" timeZone="Europe/Berlin">
        <AddActivityModal defaultDate="2026-03-29" defaultTime="02:30" onClose={() => {}} />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText(S.subject), { target: { value: "تماس" } });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent("وجود ندارد");
    expect(create).not.toHaveBeenCalled();
  });
  it("explains legacy all-day uncertainty without backfilling on an unrelated edit", async () => {
    const S = activitiesMessagesForLocale("fa");
    render(
      <LocaleProvider locale="fa" timeZone="Asia/Tehran">
        <ActivityEditModal
          activity={{
            id: "a",
            typeId: "t",
            subject: "تماس",
            priority: null,
            dueAtIso: "2026-03-20T20:30:00.000Z",
            allDay: true,
            durationMinutes: null,
            location: null,
            done: false,
          }}
          onClose={() => {}}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(/منطقهٔ زمانی اولیه ثبت نشده/)).toBeInTheDocument();
    expect(screen.getByLabelText(S.dueDate)).toHaveValue("2026-03-21");
    fireEvent.change(screen.getByLabelText(S.subject), { target: { value: "پیگیری" } });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith({ id: "a", subject: "پیگیری" }, "csrf"));
  });
  it("shows the retained offset and preserves a later-fold instant on an English subject-only edit", async () => {
    render(
      <LocaleProvider timeZone="Europe/Berlin">
        <ActivityEditModal
          activity={{
            id: "a",
            typeId: "t",
            subject: "Call",
            priority: null,
            dueAtIso: "2026-10-25T01:30:24.123Z",
            allDay: false,
            durationMinutes: 37,
            location: null,
            done: false,
          }}
          onClose={() => {}}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(/UTC\+01:00/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith({ id: "a", subject: "Renamed" }, "csrf"));
  });
});
