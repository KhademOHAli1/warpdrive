// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BoardColumn } from "@/features/deals/BoardColumn";
import { DealCard } from "@/features/deals/DealCard";
import { baseCard } from "@/features/deals/dealCardTestFixture";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { DealSidebar } from "./DealSidebar";
import { hide, makeWorkspace } from "./dealSidebarFixtures";
import { ParticipantsDialog } from "./ParticipantsDialog";
import type { DealParticipant } from "./participantsList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/features/deals/updateAction", () => ({ updateDealAction: vi.fn() }));
vi.mock("./DealSummaryActionList", () => ({ DealSummaryActionList: () => null }));
vi.mock("./sidebar/DealPersonSection", () => ({ DealPersonSection: () => null }));
vi.mock("./sidebar/ParticipantsSection", () => ({ ParticipantsSection: () => null }));
vi.mock("./sidebar/RecordOrganizationSection", () => ({ RecordOrganizationSection: () => null }));
vi.mock("./sidebar/SourceBlock", () => ({ SourceBlock: () => null }));
vi.mock("./sidebar/OrgSwitchDialog", () => ({ OrgSwitchDialog: () => null }));
vi.mock("./sidebar/ManageSectionsDialogLazy", () => ({ ManageSectionsDialog: () => null }));
vi.mock("./sidebar/SectionHeaderMenu", () => ({ SectionHeaderMenu: () => null }));
vi.mock("./ParticipantLinkField", () => ({ ParticipantLinkField: () => null }));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: ({ attributes }: { attributes?: { roleDescription?: string } }) => ({
    attributes: {
      role: "button",
      tabIndex: 0,
      "aria-roledescription": attributes?.roleDescription ?? "draggable",
      "aria-describedby": "drag-help",
    },
    listeners: {},
    setNodeRef: vi.fn(),
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));
vi.mock("@/features/labels/useLabelColorResolver", () => ({
  useLabelColorResolver: () => () => [],
}));
vi.mock("@/features/deals/StageColumnHeader", () => ({ StageColumnHeader: () => null }));
vi.mock("@/features/deals/StageAddButton", () => ({ StageAddButton: () => null }));
afterEach(cleanup);
const instant = new Date("2026-03-20T21:00:00Z");

it("formats sidebar day counts and creation date in Persian at Tehran midnight", () => {
  render(
    <LocaleProvider locale="fa" calendar="persian" timeZone="Asia/Tehran">
      <DealSidebar
        workspace={makeWorkspace({
          createdAt: instant,
          lastActivityAt: new Date("2026-03-30T21:00:00Z"),
        })}
        now={new Date("2026-04-03T21:00:00Z")}
        isHidden={hide("summary", "person", "organization")}
        baseCurrency="USD"
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("۱۴ روز")).toBeInTheDocument();
  expect(screen.getByText("۴ روز")).toBeInTheDocument();
  expect(screen.getByText("۱ فروردین ۱۴۰۵")).toBeInTheDocument();
});

it.each([
  {
    locale: "fa" as const,
    calendar: "persian" as const,
    timeZone: "Asia/Tehran",
    date: "۱ فروردین ۱۴۰۵",
    closed: "۱۲",
    open: "۳",
  },
  {
    locale: "fa" as const,
    calendar: "gregory" as const,
    timeZone: "Asia/Tehran",
    date: "۲۱ مارس ۲۰۲۶",
    closed: "۱۲",
    open: "۳",
  },
  {
    locale: "en" as const,
    calendar: "gregory" as const,
    timeZone: "UTC",
    date: "Mar 20, 2026",
    closed: "12",
    open: "3",
  },
])(
  "uses $locale/$calendar/$timeZone for participant counts and next activity",
  ({ locale, calendar, timeZone, date, closed, open }) => {
    const participant: DealParticipant = {
      personId: "p1",
      name: "Acme Contact",
      orgName: "شرکت نمونه",
      primaryEmail: "contact@example.com",
      phone: "+98 912 000 0000",
      ownerName: "سارا",
      isPrimary: false,
      isExplicit: true,
      closedDeals: 12,
      openDeals: 3,
      nextActivityAt: instant,
    };
    render(
      <LocaleProvider locale={locale} calendar={calendar} timeZone={timeZone}>
        <ParticipantsDialog
          open
          onOpenChange={vi.fn()}
          title="Acme"
          orgId={null}
          data={{
            participants: [participant],
            add: vi.fn(),
            remove: vi.fn(),
            createAndAdd: vi.fn(),
          }}
        />
      </LocaleProvider>,
    );
    const row = screen.getByText("Acme Contact").closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLTableRowElement).getAllByRole("cell");
    expect(cells[4]).toHaveTextContent(closed);
    expect(cells[5]).toHaveTextContent(open);
    expect(cells[6]).toHaveTextContent(date);
    expect(cells[2]).toHaveTextContent("contact@example.com");
    expect(cells[3]).toHaveTextContent("+98 912 000 0000");
  },
);

it("localizes outer drag descriptions while retaining dnd-kit role and instructions", () => {
  const { container } = render(
    <LocaleProvider locale="fa">
      <BoardColumn
        stageId="s1"
        stageName="Qualified"
        order={0}
        rottingDays={null}
        cards={[baseCard]}
        dealCount={1}
        totalValue="100"
        density="comfortable"
        now={instant}
        pipelineId="p1"
        pipelines={[]}
      />
    </LocaleProvider>,
  );
  const column = container.querySelector("section");
  expect(column).toHaveAttribute("aria-roledescription", "ستون مرحله");
  const wrapper = container.querySelector('[aria-describedby="drag-help"]');
  expect(wrapper).toHaveAttribute("aria-roledescription", "کارت قابل جابه‌جایی فرصت فروش");
  expect(wrapper).toHaveAttribute("role", "button");
  expect(wrapper).toHaveAttribute("tabindex", "0");
});

it.each([
  { locale: "en" as const, label: "Rotting; 20 days in this stage" },
  { locale: "fa" as const, label: "راکد؛ ۲۰ روز در این مرحله" },
])("describes measured stage age in $locale even after a recent activity", ({ locale, label }) => {
  render(
    <LocaleProvider locale={locale}>
      <DealCard
        card={{
          ...baseCard,
          stageEnteredAt: new Date("2026-06-01T00:00:00Z"),
          lastActivityAt: new Date("2026-06-20T00:00:00Z"),
        }}
        ownerName="Sara"
        personName={null}
        orgName={null}
        labels={[]}
        rottingDays={5}
        density="comfortable"
        now={new Date("2026-06-21T00:00:00Z")}
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("status", { name: label })).toBeInTheDocument();
});
