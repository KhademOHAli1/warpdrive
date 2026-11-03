// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import { WorkflowLibrary } from "./WorkflowLibrary";

type WorkflowRow = RouterOutputs["workflows"]["list"][number];
type QuerySnapshot = {
  data: WorkflowRow[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
};
type LinkProps = { href: string; className?: string; children: ReactNode };

const query = vi.hoisted(() => ({
  data: [] as WorkflowRow[] | undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  read: vi.fn<() => QuerySnapshot>(),
  refetch: vi.fn<() => Promise<void>>(),
  create: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: { workflows: { list: { useQuery: query.read } } },
}));
vi.mock("../actions", () => ({ createWorkflowAction: query.create }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: query.push }) }));
vi.mock("next/link", () => ({
  default: ({ href, className, children }: LinkProps) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/useFormatters", () => ({
  useFormatters: () => ({ dateTime: () => "2026-11-01 10:00" }),
}));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows",
}));

const locales = [
  { locale: "en", messages: english },
  { locale: "de", messages: german },
  { locale: "fa", messages: persian },
] as const;
type LibraryMessages = (typeof locales)[number]["messages"];
const rows: WorkflowRow[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Alpha Berlin",
    active: true,
    publishedNumber: 4,
    updatedAt: new Date("2026-11-01T10:00:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "alpha Entwurf",
    active: false,
    publishedNumber: null,
    updatedAt: new Date("2026-11-01T09:00:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Bären München",
    active: false,
    publishedNumber: 2,
    updatedAt: new Date("2026-11-01T08:00:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    name: "شرکت پارس",
    active: true,
    publishedNumber: 1,
    updatedAt: new Date("2026-11-01T07:00:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    name: "دفتر تهران",
    active: false,
    publishedNumber: 3,
    updatedAt: new Date("2026-11-01T06:00:00Z"),
  },
];

function page(locale: "en" | "de" | "fa" = "en", canCreate = true) {
  return (
    <LocaleProvider locale={locale}>
      <WorkflowLibrary canCreate={canCreate} />
    </LocaleProvider>
  );
}

function expectRows(expected: readonly WorkflowRow[]) {
  expect(screen.queryAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
    expected.map((row) => `/workflows/${row.id}`),
  );
  for (const row of expected) {
    expect(screen.getByRole("link", { name: new RegExp(row.name) })).toBeVisible();
  }
}

function subset(...indices: number[]): WorkflowRow[] {
  return indices.map((index) => {
    const row = rows[index];
    if (row === undefined) throw new Error(`Missing row fixture: ${index}`);
    return row;
  });
}

function expectNoWrites() {
  expect(query.create).not.toHaveBeenCalled();
  expect(query.push).not.toHaveBeenCalled();
  expect(query.read).toHaveBeenLastCalledWith();
}

async function chooseStatus(
  user: ReturnType<typeof userEvent.setup>,
  messages: LibraryMessages,
  label: string,
) {
  await user.click(screen.getByRole("combobox", { name: messages.libraryStatus }));
  await user.click(screen.getByRole("option", { name: label }));
}

beforeEach(() => {
  query.data = rows;
  query.isLoading = false;
  query.isFetching = false;
  query.isError = false;
  query.read.mockReset().mockImplementation(() => ({
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }));
  query.refetch.mockReset().mockResolvedValue(undefined);
  query.create.mockReset();
  query.push.mockReset();
});
afterEach(cleanup);

it.each(locales)("searches loaded names and clears in $locale", async ({ locale, messages }) => {
  const user = userEvent.setup();
  render(page(locale));
  const search = screen.getByRole("searchbox", { name: messages.librarySearch });
  const clear = screen.getByRole("button", { name: messages.libraryClearFilters });
  expect(screen.getByText(messages.libraryFilterHint)).toBeVisible();
  expect(clear).toBeDisabled();
  expectRows(rows);

  await user.type(search, "  bÄREN  ");

  expectRows(subset(2));
  expect(clear).toBeEnabled();
  expect(screen.queryByRole("heading", { name: messages.empty })).not.toBeInTheDocument();
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();

  await user.click(clear);

  expect(search).toHaveValue("");
  expect(search).toHaveFocus();
  expect(clear).toBeDisabled();
  expectRows(rows);
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});

it.each([
  { label: english.libraryAllStatuses, indices: [0, 1, 2, 3, 4] },
  { label: english.active, indices: [0, 3] },
  { label: english.draft, indices: [1] },
  { label: english.paused, indices: [2, 4] },
])("filters the existing $label status", async ({ label, indices }) => {
  const user = userEvent.setup();
  render(page("en", false));

  await chooseStatus(user, english, label);

  expectRows(subset(...indices));
  expect(screen.queryByRole("button", { name: english.new })).not.toBeInTheDocument();
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});

it("searches Persian names without changing record navigation", async () => {
  const user = userEvent.setup();
  render(page("fa", false));

  await user.type(screen.getByRole("searchbox", { name: persian.librarySearch }), "  پارس  ");

  expectRows(subset(3));
  expect(screen.getByRole("link", { name: /شرکت پارس/ })).toHaveTextContent(persian.active);
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});

it("combines name and status, distinguishes no matches and clears both filters", async () => {
  const user = userEvent.setup();
  render(page());
  const search = screen.getByRole("searchbox", { name: english.librarySearch });
  await user.type(search, "  ALPHA  ");
  expectRows(subset(0, 1));
  await chooseStatus(user, english, english.draft);
  expectRows(subset(1));
  await chooseStatus(user, english, english.paused);

  expectRows([]);
  expect(screen.getByRole("status")).toHaveTextContent(english.libraryNoMatches);
  expect(screen.getByText(english.libraryNoMatchesHint)).toBeVisible();
  expect(screen.queryByRole("heading", { name: english.empty })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: english.new })).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: english.libraryClearFilters }));

  expect(search).toHaveValue("");
  expect(search).toHaveFocus();
  expect(screen.getByRole("combobox", { name: english.libraryStatus })).toHaveTextContent(
    english.libraryAllStatuses,
  );
  expectRows(rows);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});

it.each([true, false])(
  "retains confirmed server-empty creation permission: %s",
  async (canCreate) => {
    query.data = [];
    const user = userEvent.setup();
    render(page("en", canCreate));

    await user.type(screen.getByRole("searchbox", { name: english.librarySearch }), "missing");

    expect(screen.getByRole("heading", { name: english.empty })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: english.libraryNoMatches }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: english.new })).toHaveLength(canCreate ? 2 : 0);
    expect(query.refetch).not.toHaveBeenCalled();
    expectNoWrites();
  },
);

it("keeps failed and pending reads distinct from filter-empty feedback", async () => {
  query.data = [];
  query.isError = true;
  let finishRead!: () => void;
  query.refetch.mockImplementationOnce(() => {
    query.isFetching = true;
    return new Promise<void>((resolve) => {
      finishRead = resolve;
    });
  });
  const user = userEvent.setup();
  const view = render(page());
  await user.type(screen.getByRole("searchbox", { name: english.librarySearch }), "missing");
  const retry = screen.getByRole("button", { name: english.retry });
  expect(screen.getByRole("alert")).toHaveTextContent(english.loadError);
  expect(screen.queryByRole("heading", { name: english.empty })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: english.libraryNoMatches })).not.toBeInTheDocument();

  await user.click(retry);
  view.rerender(page());

  expect(retry).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(english.loading);
  await user.click(retry);
  expect(query.refetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("heading", { name: english.libraryNoMatches })).not.toBeInTheDocument();

  query.data = rows;
  query.isFetching = false;
  query.isError = false;
  await act(() => {
    finishRead();
    return Promise.resolve();
  });
  view.rerender(page());

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(english.libraryNoMatches);
  expect(screen.queryByRole("heading", { name: english.empty })).not.toBeInTheDocument();
  expect(query.refetch).toHaveBeenCalledTimes(1);
  expectNoWrites();
});

it("retains cached matching rows during fetch and waits before claiming no matches", async () => {
  query.isFetching = true;
  const user = userEvent.setup();
  const view = render(page());
  const search = screen.getByRole("searchbox", { name: english.librarySearch });
  await user.type(search, "alpha");
  expectRows(subset(0, 1));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  await user.clear(search);
  await user.type(search, "missing");

  expectRows([]);
  expect(screen.getByRole("status")).toHaveTextContent(english.loading);
  expect(screen.queryByRole("heading", { name: english.libraryNoMatches })).not.toBeInTheDocument();
  query.isFetching = false;
  view.rerender(page());

  expect(screen.getByRole("status")).toHaveTextContent(english.libraryNoMatches);
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});

it("filters cached rows after read failure without successful-empty feedback", async () => {
  query.isError = true;
  const user = userEvent.setup();
  render(page());
  const search = screen.getByRole("searchbox", { name: english.librarySearch });
  await user.type(search, "alpha");
  expectRows(subset(0, 1));
  expect(screen.getByRole("alert")).toHaveTextContent(english.loadError);

  await chooseStatus(user, english, english.paused);

  expectRows([]);
  expect(screen.queryByRole("heading", { name: english.libraryNoMatches })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: english.empty })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: english.retry })).toBeEnabled();
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});

it("does not infer empty results without an initial response", () => {
  query.data = undefined;
  render(page("en", false));

  expectRows([]);
  expect(screen.queryByRole("heading", { name: english.libraryNoMatches })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: english.empty })).not.toBeInTheDocument();
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});

it("preserves creation dialog and filter state without dispatching a create", async () => {
  const user = userEvent.setup();
  render(page());
  const search = screen.getByRole("searchbox", { name: english.librarySearch });
  await user.type(search, "missing");
  const create = screen.getByRole("button", { name: english.new });
  await user.click(create);
  const dialog = screen.getByRole("dialog", { name: english.new });
  expect(within(dialog).getByRole("textbox", { name: english.name })).toHaveFocus();

  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(create).toHaveFocus());

  expect(search).toHaveValue("missing");
  expect(screen.getByRole("status")).toHaveTextContent(english.libraryNoMatches);
  expect(query.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});
