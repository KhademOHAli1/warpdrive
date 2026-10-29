// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactsNav } from "@/app/(app)/contacts/ContactsNav";
import { EntityCreateDialogShell } from "@/features/entity-create/EntityCreateDialogShell";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { SourceOriginInfo } from "@/features/leads/inbox/SourceOriginInfo";

vi.mock("next/navigation", () => ({ usePathname: () => "/contacts/people" }));
afterEach(cleanup);

describe("Persian contacts and leads", () => {
  it("labels secondary contact navigation in Persian", () => {
    render(
      <LocaleProvider locale="fa">
        <ContactsNav />
      </LocaleProvider>,
    );
    expect(screen.getByRole("navigation", { name: "بخش‌های مخاطبان" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "افراد" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "سازمان‌ها" })).toBeTruthy();
  });

  it("localizes shared create actions while preserving submission", () => {
    const onSubmit = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <EntityCreateDialogShell
          title="افزودن مخاطب"
          error={null}
          pending={false}
          onSubmit={onSubmit}
          onClose={vi.fn()}
        >
          <p>فرم</p>
        </EntityCreateDialogShell>
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "انصراف" })).toBeTruthy();
  });

  it("explains lead origin contextually in Persian", () => {
    render(
      <LocaleProvider locale="fa">
        <SourceOriginInfo />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "درباره منشأ سرنخ" }));
    expect(screen.getByText(/منشأ سرنخ نشان می‌دهد/)).toBeTruthy();
  });
});
