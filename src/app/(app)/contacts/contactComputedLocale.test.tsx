// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";

const listQuery = vi.fn();
const emptyBuckets = { all: [], activities: [], notes: [], email: [], files: [], changelog: [] };
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    contacts: { contactTimeline: { useQuery: () => ({ data: { items: [] } }) } },
    email: { listMessagesForContact: { useQuery: () => listQuery() } },
    files: { listForEntity: { useQuery: () => ({ data: [] }) } },
    useUtils: () => ({
      contacts: {
        contactTimeline: { invalidate: vi.fn() },
        activityStats: { invalidate: vi.fn() },
      },
      email: { listMessagesForContact: { invalidate: vi.fn() } },
    }),
  },
}));
// Keep the test at the contact translation boundary; card actions and attachment reads have
// their own integration suites. The real tabs, message hooks and badge formatter render here.
vi.mock("@/app/(app)/deals/[dealId]/tabs", () => ({
  bucketByType: () => ({ all: [], activities: [], notes: [], email: [], files: [], changelog: [] }),
}));
vi.mock("@/features/deal-workspace/HistoryFeed", () => ({
  HistoryFeed: ({ emptyLabel }: { emptyLabel: ReactNode }) => <p>{emptyLabel}</p>,
}));
vi.mock("@/features/deal-workspace/PinnedNotesSection", () => ({ PinnedNotesSection: () => null }));
vi.mock("@/features/files/FileAttachments", () => ({ FileAttachments: () => null }));

import { ContactHistoryTabs } from "./ContactHistoryTabs";
import { ContactTimelinePanel } from "./contactDetail.shared";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const cases = [
  {
    locale: "fa" as const,
    all: "همه (۱۲)",
    email: "ایمیل",
    emailBadge: "ایمیل (۲)",
    notes: "یادداشت‌ها",
    files: "فایل‌ها",
    loading: "در حال دریافت ایمیل‌ها...",
    error: "ایمیل‌ها دریافت نشدند. لطفاً دوباره تلاش کنید.",
    empty: "هنوز ایمیلی به این مخاطب پیوند داده نشده است.",
  },
  {
    locale: "en" as const,
    all: "All (12)",
    email: "Email",
    emailBadge: "Email (2)",
    notes: "Notes",
    files: "Files",
    loading: "Loading emails...",
    error: "Couldn't load emails. Please try again.",
    empty: "No emails linked to this contact yet.",
  },
];
describe.each(cases)("contact computed text: $locale", (copy) => {
  it("formats badge counts and omits empty and unknown badges", () => {
    render(
      <LocaleProvider locale={copy.locale}>
        <ContactHistoryTabs
          entityType="person"
          entityId="p1"
          items={emptyBuckets}
          counts={{ all: 12, email: 2, notes: 0 }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("tab", { name: copy.all })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: copy.emailBadge })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: copy.notes })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: copy.files })).toBeInTheDocument();
  });
  it("keeps an in-flight email read distinct from a successful empty read", async () => {
    listQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(
      <LocaleProvider locale={copy.locale}>
        <ContactTimelinePanel entityType="person" entityId="p1" />
      </LocaleProvider>,
    );
    await userEvent.click(screen.getByRole("tab", { name: copy.email }));
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    expect(screen.queryByText(copy.empty)).not.toBeInTheDocument();
  });
  it("shows a failed-read explanation rather than an empty-list claim", async () => {
    listQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(
      <LocaleProvider locale={copy.locale}>
        <ContactTimelinePanel entityType="person" entityId="p1" />
      </LocaleProvider>,
    );
    await userEvent.click(screen.getByRole("tab", { name: copy.email }));
    expect(screen.getByText(copy.error)).toBeInTheDocument();
    expect(screen.queryByText(copy.empty)).not.toBeInTheDocument();
  });
});
