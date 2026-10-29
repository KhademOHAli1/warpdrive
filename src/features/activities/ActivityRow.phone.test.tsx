// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ActivityRow } from "./ActivityRow";
import type { ActivityTableRow } from "./activityRows";

afterEach(cleanup);

const baseRow: ActivityTableRow = {
  id: "a1",
  subject: "Call contact",
  typeKey: "call",
  priority: null,
  done: false,
  dueAtIso: null,
  allDay: false,
  durationMinutes: null,
  location: null,
  assigneeId: "u1",
  assigneeName: "Ann",
  ownerName: "Ann",
  dealId: null,
  dealTitle: null,
  leadId: null,
  leadTitle: null,
  personId: "p1",
  personName: "Contact",
  personEmail: null,
  personPhone: null,
  orgId: null,
  orgName: null,
};

describe("ActivityRow phone links", () => {
  it.each([
    ["+989123456789", "tel:+989123456789"],
    ["+۹۸ (۹۱۲) ۳۴۵-۶۷۸۹", "tel:+989123456789"],
    ["+٩٨ (٩١٢) ٣٤٥-٦٧٨٩", "tel:+989123456789"],
    ["+۹8 (٩1۲) 3۴٥-6۷٨9", "tel:+989123456789"],
  ])("keeps the authored %s visible while making its digits dialable", (phone, href) => {
    const row = { ...baseRow, personPhone: phone };
    render(
      <LocaleProvider locale="fa">
        <table>
          <tbody>
            <ActivityRow
              row={row}
              selected={false}
              onToggleSelect={vi.fn()}
              onToggleDone={vi.fn()}
              onRowClick={vi.fn()}
              cursor={false}
            />
          </tbody>
        </table>
      </LocaleProvider>,
    );

    const link = screen.getByRole("link", { name: phone });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("dir", "ltr");
    expect(link).toHaveTextContent(phone);
    expect(row.personPhone).toBe(phone);
  });
});
