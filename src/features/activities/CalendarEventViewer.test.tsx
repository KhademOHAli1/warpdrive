// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarEventViewer } from "./CalendarEventViewer";
import type { EditableActivity } from "./getForEdit";

afterEach(cleanup);
const event: EditableActivity = {
  id: "event",
  typeId: "meeting",
  subject: "جلسه / Besprechung",
  priority: null,
  dueAt: "2027-03-21T09:00:00Z",
  endAt: "2027-03-21T10:00:00Z",
  allDay: false,
  durationMinutes: 60,
  location: "Berlin",
  note: "<p>Tagesordnung</p>",
  videoCallUrl: "https://meet.google.com/abc-defg-hij",
  assigneeId: "owner",
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  guestPersonIds: [],
  participantUserIds: [],
  dealTitle: null,
  personName: null,
  orgName: null,
  canEdit: false,
  eventTimeZone: "Asia/Tehran",
};
it.each(["fa", "de"] as const)(
  "renders a reader view in %s without offering shared event mutations",
  (locale) => {
    render(
      <LocaleProvider locale={locale}>
        <CalendarEventViewer event={event} onClose={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(event.subject);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", event.videoCallUrl);
    expect(screen.queryByRole("button", { name: /Speichern|ذخیره/ })).not.toBeInTheDocument();
  },
);
