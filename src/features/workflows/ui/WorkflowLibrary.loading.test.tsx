// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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
type TestLinkProps = { href: string; className?: string; children: ReactNode };

const queries = vi.hoisted(() => ({
  data: [] as WorkflowRow[] | undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn<() => Promise<void>>(),
  create: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    workflows: {
      list: {
        useQuery: () => ({
          data: queries.data,
          isLoading: queries.isLoading,
          isFetching: queries.isFetching,
          isError: queries.isError,
          refetch: queries.refetch,
        }),
      },
    },
  },
}));
vi.mock("../actions", () => ({ createWorkflowAction: queries.create }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: queries.push }) }));
vi.mock("next/link", () => ({
  default: ({ href, className, children }: TestLinkProps) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/useFormatters", () => ({
  useFormatters: () => ({ dateTime: () => "2026-11-01 10:00" }),
}));

const locales = [
  { locale: "en", messages: english },
  { locale: "de", messages: german },
  { locale: "fa", messages: persian },
] as const;
type LibraryMessages = (typeof locales)[number]["messages"];
const workflowId = "0a2e900b-20fa-4f3a-91c2-2e8936ceee29";
const workflowName = "Northwind Operations";

function workflow(): WorkflowRow {
  return {
    id: workflowId,
    name: workflowName,
    active: true,
    publishedNumber: 4,
    updatedAt: new Date("2026-11-01T10:00:00Z"),
  };
}

function page(locale: "en" | "de" | "fa" = "en", canCreate = true) {
  return (
    <LocaleProvider locale={locale}>
      <WorkflowLibrary canCreate={canCreate} />
    </LocaleProvider>
  );
}

function expectNoEmptyClaim(messages: LibraryMessages) {
  expect(screen.queryByRole("heading", { name: messages.empty })).not.toBeInTheDocument();
  expect(screen.queryByText(messages.emptyHint)).not.toBeInTheDocument();
}

function expectNoWrites() {
  expect(queries.create).not.toHaveBeenCalled();
  expect(queries.push).not.toHaveBeenCalled();
}

function expectWorkflowLink() {
  expect(screen.getByRole("link", { name: new RegExp(workflowName) })).toHaveAttribute(
    "href",
    `/workflows/${workflowId}`,
  );
}

beforeEach(() => {
  queries.data = [];
  queries.isLoading = false;
  queries.isFetching = false;
  queries.isError = false;
  queries.refetch.mockReset();
  queries.refetch.mockResolvedValue(undefined);
  queries.create.mockReset();
  queries.push.mockReset();
});
afterEach(cleanup);

for (const outcome of ["empty", "nonempty"] as const) {
  it.each(locales)(
    `recovers a cached-empty read failure to confirmed ${outcome} feedback in $locale`,
    async ({ locale, messages }) => {
      queries.isError = true;
      let finishRead!: () => void;
      queries.refetch.mockImplementationOnce(() => {
        queries.isFetching = true;
        return new Promise<void>((resolve) => {
          finishRead = resolve;
        });
      });
      const user = userEvent.setup();
      const view = render(page(locale));

      expect(screen.getByRole("alert")).toHaveTextContent(messages.loadError);
      expectNoEmptyClaim(messages);
      expect(screen.getAllByRole("button", { name: messages.new })).toHaveLength(1);
      const retry = screen.getByRole("button", { name: messages.retry });
      expect(retry).toBeEnabled();

      await user.click(retry);
      view.rerender(page(locale));

      expect(queries.refetch).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent(messages.loading);
      expectNoEmptyClaim(messages);
      expect(retry).toBeDisabled();
      await user.click(retry);
      expect(queries.refetch).toHaveBeenCalledTimes(1);
      expectNoWrites();

      queries.data = outcome === "empty" ? [] : [workflow()];
      queries.isError = false;
      queries.isFetching = false;
      await act(() => {
        finishRead();
        return Promise.resolve();
      });
      view.rerender(page(locale));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      if (outcome === "empty") {
        expect(screen.getByRole("heading", { name: messages.empty })).toBeVisible();
        expect(screen.getByText(messages.emptyHint)).toBeVisible();
        expect(screen.getAllByRole("button", { name: messages.new })).toHaveLength(2);
      } else {
        expectNoEmptyClaim(messages);
        expectWorkflowLink();
        expect(screen.getAllByRole("button", { name: messages.new })).toHaveLength(1);
      }
      expect(queries.refetch).toHaveBeenCalledTimes(1);
      expectNoWrites();
    },
  );
}

it.each(locales)(
  "retains cached workflow links through a failed retry in $locale",
  async ({ locale, messages }) => {
    queries.data = [workflow()];
    queries.isError = true;
    let finishRead!: () => void;
    queries.refetch.mockImplementationOnce(() => {
      queries.isFetching = true;
      return new Promise<void>((resolve) => {
        finishRead = resolve;
      });
    });
    const user = userEvent.setup();
    const view = render(page(locale, false));
    const retry = screen.getByRole("button", { name: messages.retry });

    expect(screen.getByRole("alert")).toHaveTextContent(messages.loadError);
    expectWorkflowLink();
    expectNoEmptyClaim(messages);

    await user.click(retry);
    view.rerender(page(locale, false));

    expect(retry).toBeDisabled();
    expectWorkflowLink();
    expectNoEmptyClaim(messages);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.new })).not.toBeInTheDocument();

    queries.isFetching = false;
    await act(() => {
      finishRead();
      return Promise.resolve();
    });
    view.rerender(page(locale, false));

    expect(screen.getByRole("alert")).toHaveTextContent(messages.loadError);
    expect(retry).toBeEnabled();
    expectWorkflowLink();
    expectNoEmptyClaim(messages);
    expect(queries.refetch).toHaveBeenCalledTimes(1);
    expectNoWrites();
  },
);

it.each([true, false])(
  "preserves creation permission for a confirmed empty list: %s",
  (canCreate) => {
    render(page("en", canCreate));

    expect(screen.getByRole("heading", { name: english.empty })).toBeVisible();
    expect(screen.queryAllByRole("button", { name: english.new })).toHaveLength(canCreate ? 2 : 0);
    expect(queries.refetch).not.toHaveBeenCalled();
    expectNoWrites();
  },
);

it("does not turn a cached-empty initial loading snapshot into a confirmed empty result", () => {
  queries.isLoading = true;
  queries.isFetching = true;
  render(page());

  expect(screen.getByRole("status")).toHaveTextContent(english.loading);
  expectNoEmptyClaim(english);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(queries.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});

it("does not claim an empty library before an initial response exists", () => {
  queries.data = undefined;
  queries.isLoading = false;
  queries.isFetching = false;
  queries.isError = false;
  render(page("en", false));

  expectNoEmptyClaim(english);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(queries.refetch).not.toHaveBeenCalled();
  expectNoWrites();
});
