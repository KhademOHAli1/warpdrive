// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CurrentAccountConcentrationReport } from "../currentAccountConcentrationReport";
import { CurrentAccountConcentrationPanel } from "./CurrentAccountConcentrationPanel";

type AvailableReport = Extract<CurrentAccountConcentrationReport, { state: "available" }>;
const fixture = vi.hoisted(() => ({
  read: vi.fn(),
  refetch: vi.fn(),
  report: undefined as CurrentAccountConcentrationReport | undefined,
  fetchedAfterMount: true,
  fetching: false,
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    stats: {
      currentAccountConcentration: {
        useQuery: (input: unknown, options: unknown) => {
          fixture.read(input, options);
          return {
            data: fixture.report,
            isFetchedAfterMount: fixture.fetchedAfterMount,
            isFetching: fixture.fetching,
            isPaused: false,
            isPlaceholderData: false,
            isError: false,
            refetch: fixture.refetch,
          };
        },
      },
    },
  },
}));

const scope = {
  currency: "EUR",
  pipelineId: null,
  ownerScope: { kind: "all" },
  from: "2026-05-01",
  to: "2026-05-01",
  timeZoneIdentity: "Europe/Berlin",
} as const;
const available: AvailableReport = {
  state: "available",
  definition: "current-linked-organization-won-nominal-v1",
  currency: "EUR",
  timeZone: "Europe/Berlin",
  from: scope.from,
  to: scope.to,
  effectiveOwnerScope: "all",
  coverage: {
    eligibleWonDeals: 9,
    linkedWonDeals: 9,
    unresolvedWonDeals: 0,
    linkedOrganizations: 8,
    multiWonLinkedOrganizations: 1,
    linkedWonDealsWithValue: 9,
    linkedWonDealsWithoutValue: 0,
  },
  linkedKnownNominalNet: "139.9999",
  concentration: {
    state: "available",
    positiveNetOrganizations: 6,
    zeroNetOrganizations: 1,
    negativeNetOrganizations: 1,
    positiveNetDenominator: "141.9999",
    largestNetNumerator: "99.9999",
    topFiveNetNumerator: "138.9999",
  },
};

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.report = available;
  fixture.fetchedAfterMount = true;
  fixture.fetching = false;
});

test("shows the exact nominal denominator, rounded shares and repeated-win coverage", () => {
  render(<CurrentAccountConcentrationPanel scope={scope} />);
  expect(fixture.read).toHaveBeenCalledWith(
    scope,
    expect.objectContaining({
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
      retry: false,
    }),
  );
  expect(screen.getByText("€141.9999")).toBeInTheDocument();
  expect(screen.getByText("€99.9999")).toBeInTheDocument();
  expect(screen.getByText("70.4%")).toBeInTheDocument();
  expect(screen.getByText("97.9%")).toBeInTheDocument();
  expect(screen.getByText("Organizations with multiple won deals")).toBeInTheDocument();
  expect(screen.getByText(/Confirmed expansion.*separate evidence/)).toBeInTheDocument();
});

test("withholds shares for unresolved links and distinguishes an unknown nominal subtotal", () => {
  fixture.report = {
    ...available,
    coverage: {
      eligibleWonDeals: 2,
      linkedWonDeals: 1,
      unresolvedWonDeals: 1,
      linkedOrganizations: 1,
      multiWonLinkedOrganizations: 0,
      linkedWonDealsWithValue: 0,
      linkedWonDealsWithoutValue: 1,
    },
    linkedKnownNominalNet: null,
    concentration: { state: "withheld", reason: "unresolved-organization" },
  };
  const page = render(<CurrentAccountConcentrationPanel scope={scope} />);
  expect(screen.getByText("No linked amount recorded")).toBeInTheDocument();
  expect(
    screen.getByText(/until every won deal in scope has a visible linked organization/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Largest organization share")).not.toBeInTheDocument();

  fixture.report = available;
  page.rerender(<CurrentAccountConcentrationPanel scope={{ ...scope, to: "2026-05-02" }} />);
  expect(screen.getByText("This pipeline or report scope is unavailable.")).toBeInTheDocument();
  expect(screen.queryByText("Largest organization share")).not.toBeInTheDocument();
});

test("holds cached figures until refresh and removes them when current access fails", () => {
  fixture.fetchedAfterMount = false;
  const page = render(<CurrentAccountConcentrationPanel scope={scope} />);
  expect(screen.queryByText("70.4%")).not.toBeInTheDocument();
  fixture.fetchedAfterMount = true;
  page.rerender(<CurrentAccountConcentrationPanel scope={scope} />);
  expect(screen.getByText("70.4%")).toBeInTheDocument();
  fixture.fetching = true;
  page.rerender(<CurrentAccountConcentrationPanel scope={scope} />);
  expect(screen.queryByText("70.4%")).not.toBeInTheDocument();
  fixture.fetching = false;
  fixture.report = { state: "permission" };
  page.rerender(<CurrentAccountConcentrationPanel scope={scope} />);
  expect(
    screen.getByText("Your current access does not allow you to see this report."),
  ).toBeInTheDocument();
  expect(screen.queryByText("€141.9999")).not.toBeInTheDocument();
});

test.each([
  ["de", "Wert gewonnener Deals nach verknüpfter Organisation"],
  ["fa", "ارزش معاملات موفق به تفکیک سازمان پیوندخورده"],
] as const)("renders the localized account title in %s", (locale, title) => {
  render(
    <LocaleProvider locale={locale}>
      <CurrentAccountConcentrationPanel scope={scope} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
});
