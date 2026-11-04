// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import type {
  archiveWorkflowAction,
  createWorkflowAction,
  duplicateWorkflowAction,
  unarchiveWorkflowAction,
} from "../actions";
import { initialBlankDefinition } from "../editorModel";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { LibraryLocationInput } from "./libraryLocation";
import type { WorkflowDetail } from "./useWorkflowEditor";
import { WorkflowLibrary } from "./WorkflowLibrary";

// The current router response is the source of truth for all list/owner fixtures.
type Page = RouterOutputs["workflows"]["list"];
type Row = Page["items"][number];
type Request = LibraryLocationInput;
type QueryError = { message: string; data: { code: string } };
const io = vi.hoisted(() => ({
  data: undefined as Page | undefined,
  loading: false,
  fetching: false,
  placeholder: false,
  error: null as QueryError | null,
  list: vi.fn<(input?: Request, options?: unknown) => void>(),
  owners: vi.fn<(input: unknown, options?: unknown) => void>(),
  ownerError: null as QueryError | null,
  ownerData: { items: [] as { id: string; name: string }[], nextCursor: null as string | null },
  refetch: vi.fn<() => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  create: vi.fn<typeof createWorkflowAction>(),
  archive: vi.fn<typeof archiveWorkflowAction>(),
  unarchive: vi.fn<typeof unarchiveWorkflowAction>(),
  duplicate: vi.fn<typeof duplicateWorkflowAction>(),
  push: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ workflows: { list: { invalidate: io.invalidate } } }),
    workflows: {
      list: {
        useQuery: (input?: Request, options?: unknown) => {
          io.list(input, options);
          return {
            data: io.data,
            isLoading: io.loading,
            isPending: io.loading,
            isFetching: io.fetching,
            isPlaceholderData: io.placeholder,
            isError: io.error !== null,
            error: io.error,
            refetch: io.refetch,
          };
        },
      },
      owners: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          const enabled = options?.enabled !== false;
          if (enabled) io.owners(input, options);
          return {
            data: enabled ? io.ownerData : undefined,
            isLoading: false,
            isFetching: false,
            isError: enabled && io.ownerError !== null,
            error: enabled ? io.ownerError : null,
            refetch: io.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("../actions", () => ({
  createWorkflowAction: io.create,
  archiveWorkflowAction: io.archive,
  unarchiveWorkflowAction: io.unarchive,
  duplicateWorkflowAction: io.duplicate,
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "workflow-csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: io.push, refresh: io.refresh }) }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/useFormatters", () => ({ useFormatters: () => ({ dateTime: () => "2026-11-03" }) }));

const firstId = "0352d6bd-5e13-433a-85cf-49075ebbb80b";
const secondId = "70ed326a-76c7-4467-babd-c7839a9023d5";
const ownerId = "fced09ac-42d9-4aa8-9cb1-f53ad6f307af";
const copiedId = "a7c7d8b5-a43d-449d-9ca3-dfa427c4ea2c";
const defaults: Request = {
  query: "",
  archive: "current",
  status: "all",
  health: "all",
  sort: "updated-desc",
  limit: 25,
};
const locales = [
  { locale: "en", messages: english, archive: "Archive workflow", duplicate: "Duplicate workflow" },
  {
    locale: "de",
    messages: german,
    archive: "Workflow archivieren",
    duplicate: "Workflow duplizieren",
  },
  { locale: "fa", messages: persian, archive: "بایگانی گردش‌کار", duplicate: "کپی گردش‌کار" },
] as const;

function row(id = firstId, name = "پیگیری – Rückruf"): Row {
  return {
    id,
    name,
    revision: 7,
    active: true,
    publishedNumber: 2,
    archivedAt: null,
    lifecycle: "active",
    updatedAt: new Date("2026-11-03T10:00:00Z"),
    owner: { id: ownerId, name: "Workflow Owner" },
    latestLiveRun: null,
    capabilities: { archive: true, unarchive: false, duplicate: true },
  };
}
function page(items = [row()]): Page {
  return {
    items,
    nextCursor: null,
    scopeHasItems: items.length > 0,
    capabilities: { create: true, filterOwners: false },
  };
}
function saved(id = firstId): Omit<WorkflowDetail, "capabilities"> {
  return {
    id,
    ownerId,
    name: "Saved workflow",
    revision: 8,
    draft: initialBlankDefinition("Start"),
    active: false,
    publishedNumber: 2,
    archivedAt: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-03T10:00:00Z"),
  };
}
function view(locale: "en" | "de" | "fa" = "en", canCreate = true) {
  return (
    <LocaleProvider locale={locale}>
      <WorkflowLibrary canCreate={canCreate} />
    </LocaleProvider>
  );
}
function lastRequest() {
  return io.list.mock.calls.at(-1)?.[0];
}
function readAttempts() {
  return io.refetch.mock.calls.length + io.invalidate.mock.calls.length;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
async function select(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}
async function command(user: ReturnType<typeof userEvent.setup>, label: string) {
  const opener = screen.getByRole("button", { name: `Actions for ${row().name}` });
  opener.focus();
  await user.keyboard("{Enter}");
  const item = await screen.findByRole("menuitem", { name: label });
  item.focus();
  await user.keyboard("{Enter}");
  return opener;
}

beforeEach(() => {
  vi.clearAllMocks();
  io.data = page();
  io.loading = false;
  io.fetching = false;
  io.placeholder = false;
  io.error = null;
  io.ownerError = null;
  io.ownerData = { items: [{ id: ownerId, name: "Workflow Owner" }], nextCursor: null };
  io.refetch
    .mockReset()
    .mockImplementation(() => Promise.resolve({ data: io.data, isError: false }));
  io.invalidate.mockReset().mockResolvedValue(undefined);
  io.push.mockReset();
  io.refresh.mockReset();
  io.create.mockReset().mockResolvedValue({
    ok: true,
    value: { ...saved(copiedId), revision: 1, active: false, publishedNumber: null },
  });
  io.archive
    .mockReset()
    .mockResolvedValue({ ok: true, value: { ...saved(), archivedAt: new Date() } });
  io.unarchive.mockReset().mockResolvedValue({ ok: true, value: saved() });
  io.duplicate.mockReset().mockResolvedValue({
    ok: true,
    value: { ...saved(copiedId), revision: 1, active: false, publishedNumber: null },
  });
});
afterEach(cleanup);

describe("server-owned workflow library pages", () => {
  it("sends trimmed multilingual search and combined status to the server, resetting the cursor", async () => {
    io.data = { ...page(), nextCursor: "page-two" };
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastRequest()).toEqual({ ...defaults, cursor: "page-two" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Search workflows" }),
      "  Rückruf پیگیری  ",
    );
    await select(user, english.libraryStatus, english.active);
    await waitFor(() =>
      expect(lastRequest()).toEqual({ ...defaults, query: "Rückruf پیگیری", status: "active" }),
    );
    expect(screen.getByRole("searchbox")).toHaveAttribute("maxLength", "200");
    expect(screen.getByRole("searchbox")).toHaveAttribute("dir", "auto");
    expect(io.create).not.toHaveBeenCalled();
  });

  it("uses bounded Next/Previous cursor history and resets all page/filter state on Clear", async () => {
    io.data = { ...page(), nextCursor: "second" };
    const user = userEvent.setup();
    const mounted = render(view());
    await user.click(screen.getByRole("button", { name: "Next page" }));
    io.data = { ...page([row(secondId, "Second page")]), nextCursor: "third" };
    mounted.rerender(view());
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(lastRequest()).toEqual(defaults));
    await user.type(screen.getByRole("searchbox"), "Specific");
    await select(user, "Live run health", "Latest live run failed");
    await select(user, "Sort workflows", "Name (A–Z)");
    await user.click(screen.getByRole("button", { name: english.libraryClearFilters }));
    await waitFor(() => expect(lastRequest()).toEqual(defaults));
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("resets status/page on archive-view change and obtains owner options only in permitted scope", async () => {
    io.data = { ...page(), nextCursor: "next", capabilities: { create: true, filterOwners: true } };
    const user = userEvent.setup();
    const heldOwnerRetry = deferred<unknown>();
    io.ownerError = { message: "old owner read", data: { code: "INTERNAL_SERVER_ERROR" } };
    io.refetch.mockImplementationOnce(() => heldOwnerRetry.promise);
    render(view());
    try {
      await user.click(screen.getByRole("button", { name: english.retry }));
      expect(io.refetch).toHaveBeenCalledTimes(1);
      io.ownerError = null;
      await select(user, english.libraryStatus, english.active);
      await user.click(screen.getByRole("button", { name: "Next page" }));
      await select(user, "Workflow visibility", "Archived workflows");
      await waitFor(() => expect(lastRequest()).toEqual({ ...defaults, archive: "archived" }));
      await waitFor(() =>
        expect(io.owners.mock.calls.at(-1)?.[0]).toEqual({
          archive: "archived",
          query: "",
          limit: 25,
        }),
      );
      await act(async () => {
        heldOwnerRetry.resolve({ isError: true });
      });
      expect(screen.queryByText(english.libraryOwnersError)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: english.retry })).not.toBeInTheDocument();
      await user.type(screen.getByRole("searchbox", { name: english.libraryOwnerSearch }), " ");
      expect(io.owners.mock.calls.at(-1)?.[0]).toEqual({
        archive: "archived",
        query: "",
        limit: 25,
      });
      expect(screen.queryByText(english.libraryNoOwners)).not.toBeInTheDocument();
      await select(user, "Workflow owner", "Workflow Owner");
      await waitFor(() =>
        expect(lastRequest()).toEqual({ ...defaults, archive: "archived", ownerId }),
      );
    } finally {
      await act(async () => {
        heldOwnerRetry.resolve({ isError: true });
      });
    }
  });

  it("paginates bounded owners, merges unique options, and resets query/archive continuations", async () => {
    const secondOwner = { id: "32dbaf94-46a3-49a6-9783-cff314ba81f6", name: "Second owner" };
    const matchedOwner = { id: "65524552-6819-473f-ac23-4f0b2cf200e4", name: "Z matched owner" };
    const archivedOwner = { id: "c7a0a44b-cbec-4df9-b0d2-6d4fe0f520fa", name: "Archived owner" };
    const firstOwner = { id: ownerId, name: "Workflow Owner" };
    const retainedOwner = { id: "bcac63ac-bb0a-436a-9f17-4a8d70bd4f7a", name: "Retained owner" };
    io.data = { ...page(), capabilities: { create: true, filterOwners: true } };
    io.ownerData = { items: [firstOwner, retainedOwner], nextCursor: "owners-second" };
    const user = userEvent.setup();
    const mounted = render(view());
    await user.click(screen.getByRole("button", { name: english.libraryMoreOwners }));
    expect(io.owners.mock.calls.at(-1)?.[0]).toEqual({
      archive: "current",
      query: "",
      limit: 25,
      cursor: "owners-second",
    });
    io.ownerData = { items: [firstOwner, secondOwner], nextCursor: null };
    mounted.rerender(view());
    await user.click(screen.getByRole("combobox", { name: english.libraryOwner }));
    expect(await screen.findAllByRole("option", { name: firstOwner.name })).toHaveLength(1);
    expect(screen.getAllByRole("option", { name: retainedOwner.name })).toHaveLength(1);
    expect(screen.getAllByRole("option", { name: secondOwner.name })).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("button", { name: english.libraryMoreOwners }),
    ).not.toBeInTheDocument();

    io.ownerData = { items: [matchedOwner], nextCursor: "matched-second" };
    await user.type(screen.getByRole("searchbox", { name: english.libraryOwnerSearch }), "  Z  ");
    expect(io.owners.mock.calls.at(-1)?.[0]).toEqual({ archive: "current", query: "Z", limit: 25 });
    await user.click(screen.getByRole("combobox", { name: english.libraryOwner }));
    expect(await screen.findByRole("option", { name: matchedOwner.name })).toBeVisible();
    expect(screen.queryByRole("option", { name: firstOwner.name })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: retainedOwner.name })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: secondOwner.name })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: english.libraryMoreOwners }));
    expect(io.owners.mock.calls.at(-1)?.[0]).toEqual({
      archive: "current",
      query: "Z",
      limit: 25,
      cursor: "matched-second",
    });
    io.ownerData = { items: [archivedOwner], nextCursor: null };
    await select(user, english.libraryArchive, english.libraryArchived);
    expect(io.owners.mock.calls.at(-1)?.[0]).toEqual({ archive: "archived", query: "", limit: 25 });
    expect(screen.getByRole("searchbox", { name: english.libraryOwnerSearch })).toHaveValue("");
    await user.click(screen.getByRole("combobox", { name: english.libraryOwner }));
    expect(await screen.findByRole("option", { name: archivedOwner.name })).toBeVisible();
    expect(screen.queryByRole("option", { name: matchedOwner.name })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    for (const [request] of io.owners.mock.calls)
      expect(request).toEqual(expect.objectContaining({ limit: 25 }));
    expect(io.refetch).not.toHaveBeenCalled();
    expect(io.create).not.toHaveBeenCalled();
    expect(io.archive).not.toHaveBeenCalled();
    expect(io.unarchive).not.toHaveBeenCalled();
    expect(io.duplicate).not.toHaveBeenCalled();
  });

  it("lets current server capabilities revoke stale create/owner controls", async () => {
    const heldOwnerRetry = deferred<unknown>();
    io.data = { ...page(), capabilities: { create: true, filterOwners: true } };
    io.ownerError = { message: "owner read", data: { code: "INTERNAL_SERVER_ERROR" } };
    io.refetch.mockImplementationOnce(() => heldOwnerRetry.promise);
    const user = userEvent.setup();
    const mounted = render(view("en", true));
    try {
      await user.click(screen.getByRole("button", { name: english.retry }));
      expect(io.refetch).toHaveBeenCalledTimes(1);
      io.data = { ...page(), capabilities: { create: false, filterOwners: false } };
      io.ownerError = null;
      mounted.rerender(view("en", true));
      expect(screen.queryByRole("button", { name: english.new })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Workflow owner" })).not.toBeInTheDocument();
      expect(io.create).not.toHaveBeenCalled();
      io.data = { ...page(), capabilities: { create: true, filterOwners: true } };
      io.ownerError = { message: "fresh owner read", data: { code: "INTERNAL_SERVER_ERROR" } };
      mounted.rerender(view("en", true));
      expect(screen.getByRole("button", { name: english.retry })).toBeEnabled();
      await act(async () => {
        heldOwnerRetry.resolve({ isError: true });
      });
      expect(screen.getByRole("button", { name: english.retry })).toBeEnabled();
      expect(io.refetch).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        heldOwnerRetry.resolve({ isError: true });
      });
    }
  });

  it("does not infer row write rights from create permission and retains authorized history entry", async () => {
    io.data = page([
      { ...row(), capabilities: { archive: false, unarchive: false, duplicate: false } },
    ]);
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("button", { name: `Actions for ${row().name}` }));
    expect(await screen.findByRole("menuitem", { name: "View history" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Archive workflow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Unarchive workflow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Duplicate workflow" })).not.toBeInTheDocument();
    expect(io.archive).not.toHaveBeenCalled();
    expect(io.unarchive).not.toHaveBeenCalled();
    expect(io.duplicate).not.toHaveBeenCalled();
  });

  it("does not present old-filter placeholder rows as confirmed new-filter matches", async () => {
    const user = userEvent.setup();
    const mounted = render(view());
    await user.type(screen.getByRole("searchbox"), "Different name");
    io.fetching = true;
    io.placeholder = true;
    mounted.rerender(view());
    expect(screen.getByRole("status")).toHaveTextContent(english.loading);
    expect(screen.queryByRole("link", { name: new RegExp(row().name) })).not.toBeInTheDocument();
    expect(screen.queryByText(english.libraryNoMatches)).not.toBeInTheDocument();
    expect(screen.queryByText(english.empty)).not.toBeInTheDocument();
  });

  it.each(locales)(
    "distinguishes current-key transient failure, known denial, and empty scope in $locale",
    async ({ locale, messages }) => {
      const user = userEvent.setup();
      io.error = { message: "private backend detail", data: { code: "INTERNAL_SERVER_ERROR" } };
      const mounted = render(view(locale));
      expect(screen.getByRole("alert")).toHaveTextContent(messages.loadError);
      expect(screen.getByRole("link", { name: new RegExp(row().name) })).toBeVisible();
      expect(screen.queryByText(messages.empty)).not.toBeInTheDocument();
      const retry = screen.getByRole("button", { name: messages.retry });
      await user.click(retry);
      expect(io.refetch).toHaveBeenCalledTimes(1);
      io.fetching = true;
      mounted.rerender(view(locale));
      expect(retry).toBeDisabled();
      await user.click(retry);
      expect(io.refetch).toHaveBeenCalledTimes(1);
      io.fetching = false;
      mounted.rerender(view(locale));
      await user.click(screen.getByRole("button", { name: messages.new }));
      expect(await screen.findByRole("dialog")).toBeVisible();
      io.error = { message: ERROR_IDS.WORKFLOW_DENIED, data: { code: "FORBIDDEN" } };
      mounted.rerender(view(locale));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: messages.title, level: 1 })).toHaveFocus(),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(messages.denied);
      expect(screen.queryByRole("link", { name: new RegExp(row().name) })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: messages.new })).not.toBeInTheDocument();
      expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
      io.error = null;
      io.data = page([]);
      mounted.rerender(view(locale));
      expect(screen.getByRole("heading", { name: messages.empty })).toBeVisible();
    },
  );

  it("keeps active filters and Clear available for matching-empty, distinct from archived-empty", async () => {
    const user = userEvent.setup();
    const mounted = render(view());
    await user.type(screen.getByRole("searchbox"), "No match");
    io.data = { ...page([]), scopeHasItems: true };
    mounted.rerender(view());
    expect(screen.getByText(english.libraryNoMatches)).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveValue("No match");
    expect(screen.getByRole("button", { name: english.libraryClearFilters })).toBeEnabled();
    await select(user, "Workflow visibility", "Archived workflows");
    io.data = page([]);
    mounted.rerender(view());
    expect(screen.getByRole("heading", { name: "No archived workflows" })).toBeVisible();
    expect(screen.queryByText(english.empty)).not.toBeInTheDocument();
  });

  it("shows owner provenance, separate lifecycle/live health, and independent row/menu targets", () => {
    io.data = page([
      { ...row(), latestLiveRun: { id: secondId, status: "failed", createdAt: new Date() } },
    ]);
    render(view());
    const link = screen.getByRole("link", { name: new RegExp(row().name) });
    const actions = screen.getByRole("button", { name: `Actions for ${row().name}` });
    expect(link).not.toContainElement(actions);
    expect(actions.closest("a")).toBeNull();
    expect(screen.getByText("Workflow Owner")).toBeVisible();
    expect(screen.getByText(english.active)).toBeVisible();
    expect(screen.getByText(/^(Failed|Latest live run failed)$/)).toBeVisible();
    expect(screen.getByText("Runs as: person starting the run")).toBeVisible();
    expect(screen.queryByText("Runs as: Workflow Owner")).not.toBeInTheDocument();
    expect(screen.queryByText(english.notReady)).not.toBeInTheDocument();
  });
});

describe("library lifecycle commands and shared Radix recovery", () => {
  it.each(["create", "duplicate"] as const)(
    "retains the unknown %s context across dismissal and requires confirmed reconciliation",
    async (kind) => {
      const action = kind === "create" ? io.create : io.duplicate;
      action.mockRejectedValueOnce(new Error("response lost"));
      const user = userEvent.setup();
      render(view());
      async function open() {
        if (kind === "create") await user.click(screen.getByRole("button", { name: english.new }));
        else await command(user, "Duplicate workflow");
        return screen.findByRole("dialog");
      }
      let dialog = await open();
      if (kind === "create") await select(user, english.template, english.blankTemplate);
      const label = kind === "create" ? english.name : "Name for copied workflow";
      const submit = kind === "create" ? english.create : "Duplicate workflow";
      await user.clear(within(dialog).getByRole("textbox", { name: label }));
      await user.type(
        within(dialog).getByRole("textbox", { name: label }),
        "Retain uncertain input",
      );
      await user.click(within(dialog).getByRole("button", { name: submit }));
      expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm");
      await user.click(within(dialog).getByRole("button", { name: english.close }));
      dialog = await open();
      expect(within(dialog).getByRole("textbox", { name: label })).toHaveValue(
        "Retain uncertain input",
      );
      if (kind === "create")
        expect(within(dialog).getByRole("combobox", { name: english.template })).toHaveTextContent(
          english.blankTemplate,
        );
      expect(within(dialog).getByRole("button", { name: submit })).toBeDisabled();
      expect(action).toHaveBeenCalledTimes(1);
      io.refetch.mockResolvedValueOnce(undefined);
      await user.click(within(dialog).getByRole("button", { name: "Review workflows" }));
      expect(
        within(dialog).getByRole("button", {
          name: "I reviewed the library; allow another attempt",
        }),
      ).toBeDisabled();
      io.refetch.mockResolvedValueOnce({ data: io.data, isError: false });
      await user.click(within(dialog).getByRole("button", { name: "Review workflows" }));
      const allow = within(dialog).getByRole("button", {
        name: "I reviewed the library; allow another attempt",
      });
      await waitFor(() => expect(allow).toBeEnabled());
      await user.click(allow);
      expect(action).toHaveBeenCalledTimes(1);
      await user.click(within(dialog).getByRole("button", { name: submit }));
      await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    },
  );

  it("offers First page for an incoming cursor while retaining its search context", async () => {
    io.data = page([row(firstId, "Keep")]);
    const user = userEvent.setup();
    render(
      <LocaleProvider locale="en">
        <WorkflowLibrary canCreate initialLocation="/workflows?query=Keep&cursor=page-two" />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Return to first page" }));
    await waitFor(() => expect(lastRequest()).toEqual({ ...defaults, query: "Keep" }));
  });

  it("hides cached owner options and clears owner/cursor on confirmed owner denial", async () => {
    io.data = {
      ...page(),
      nextCursor: "next-page",
      capabilities: { create: true, filterOwners: true },
    };
    const user = userEvent.setup();
    const mounted = render(view());
    await select(user, "Workflow owner", "Workflow Owner");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    io.ownerError = { message: ERROR_IDS.WORKFLOW_DENIED, data: { code: "FORBIDDEN" } };
    mounted.rerender(view());
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Workflow owner" })).not.toBeInTheDocument(),
    );
    expect(lastRequest()?.ownerId).toBeUndefined();
    expect(lastRequest()?.cursor).toBeUndefined();
    expect(screen.queryByRole("link", { name: new RegExp(row().name) })).not.toBeInTheDocument();
    io.data = { ...page(), capabilities: { create: false, filterOwners: false } };
    mounted.rerender(view());
    await waitFor(() =>
      expect(screen.getByRole("link", { name: new RegExp(row().name) })).toBeVisible(),
    );
    expect(screen.queryByRole("combobox", { name: "Workflow owner" })).not.toBeInTheDocument();
  });

  it.each(locales)(
    "retains localized blank/follow-up templates entry in $locale",
    async ({ locale, messages }) => {
      const user = userEvent.setup();
      render(view(locale));
      await user.click(screen.getByRole("button", { name: messages.new }));
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      await user.click(within(dialog).getByRole("combobox", { name: messages.template }));
      expect(await screen.findByRole("option", { name: messages.followUpTemplate })).toBeVisible();
      await user.click(screen.getByRole("option", { name: messages.blankTemplate }));
      await user.clear(within(dialog).getByRole("textbox", { name: messages.name }));
      await user.type(
        within(dialog).getByRole("textbox", { name: messages.name }),
        "نام – Rückruf",
      );
      expect(within(dialog).getByRole("textbox", { name: messages.name })).toHaveAttribute(
        "dir",
        "auto",
      );
      await user.click(within(dialog).getByRole("button", { name: messages.create }));
      await waitFor(() => expect(io.create).toHaveBeenCalledTimes(1));
      expect(io.create).toHaveBeenCalledWith(
        { name: "نام – Rückruf", definition: initialBlankDefinition(messages.start) },
        "workflow-csrf",
      );
      expect(io.push).toHaveBeenCalledWith(`/workflows/${copiedId}`);
    },
  );

  it.each(["create", "duplicate"] as const)(
    "preserves a known %s ACK when router.push throws; Open retries navigation only",
    async (kind) => {
      io.push.mockImplementationOnce(() => {
        throw new Error("navigation unavailable");
      });
      const user = userEvent.setup();
      render(view());
      if (kind === "create") await user.click(screen.getByRole("button", { name: english.new }));
      else await command(user, "Duplicate workflow");
      const dialog = await screen.findByRole("dialog");
      const submit = within(dialog).getByRole("button", {
        name: kind === "create" ? english.create : "Duplicate workflow",
      });
      await user.click(submit);
      await waitFor(() => expect(io.push).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(english.error)).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        kind === "create" ? "Workflow created" : "Workflow copied",
      );
      await user.click(
        screen.getByRole("button", { name: kind === "create" ? english.open : "Open copy" }),
      );
      expect(io.push).toHaveBeenLastCalledWith(`/workflows/${copiedId}`);
      expect(kind === "create" ? io.create : io.duplicate).toHaveBeenCalledTimes(1);
    },
  );

  it("does not treat a void navigation request as confirmed arrival or replay creation", async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("button", { name: english.new }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: english.create }),
    );
    await waitFor(() => expect(io.push).toHaveBeenCalledTimes(1));
    expect(io.create).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Workflow opened")).not.toBeInTheDocument();
  });

  it.each(["archive", "unarchive"] as const)(
    "retains the %s ACK through failed refresh and retries reads only",
    async (kind) => {
      io.refetch.mockRejectedValue(new Error("read failed"));
      io.invalidate.mockRejectedValue(new Error("read failed"));
      const user = userEvent.setup();
      const mounted = render(view());
      if (kind === "unarchive") {
        await select(user, "Workflow visibility", "Archived workflows");
        io.data = page([
          {
            ...row(),
            active: false,
            archivedAt: new Date(),
            lifecycle: "archived",
            capabilities: { archive: false, unarchive: true, duplicate: true },
          },
        ]);
        mounted.rerender(view());
      }
      const label = kind === "archive" ? "Archive workflow" : "Unarchive workflow";
      await command(user, label);
      const dialog = await screen.findByRole("alertdialog");
      if (kind === "archive")
        expect(dialog).toHaveTextContent("An incomplete run fails when it next advances");
      else expect(dialog).toHaveTextContent("returns inactive");
      await user.click(within(dialog).getByRole("button", { name: label }));
      const action = kind === "archive" ? io.archive : io.unarchive;
      await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
      expect(action).toHaveBeenCalledWith({ id: firstId, revision: 7 }, "workflow-csrf");
      await waitFor(() => expect(readAttempts()).toBe(1));
      expect(screen.getByRole("status")).toHaveTextContent(
        kind === "archive" ? "Workflow archived" : "Workflow unarchived",
      );
      expect(screen.queryByText(english.error)).not.toBeInTheDocument();
      io.refetch.mockResolvedValue({ data: io.data, isError: false });
      io.invalidate.mockResolvedValue(undefined);
      await user.click(screen.getByRole("button", { name: english.refresh }));
      await waitFor(() => expect(readAttempts()).toBe(2));
      expect(action).toHaveBeenCalledTimes(1);
    },
  );

  it.each([true, false])(
    "restores stable focus after the archived row disappears with create=%s",
    async (canCreate) => {
      const held = deferred<Awaited<ReturnType<typeof archiveWorkflowAction>>>();
      io.archive.mockReturnValueOnce(held.promise);
      io.data = {
        ...page([row(), row(secondId, "Remaining row")]),
        capabilities: { create: canCreate, filterOwners: false },
      };
      const user = userEvent.setup();
      const mounted = render(view("en", canCreate));
      const opener = await command(user, "Archive workflow");
      const dialog = await screen.findByRole("alertdialog");
      try {
        const submit = within(dialog).getByRole("button", { name: "Archive workflow" });
        await user.click(submit);
        await waitFor(() => expect(io.archive).toHaveBeenCalledTimes(1));
        expect(!submit.isConnected || submit.matches(":disabled")).toBe(true);
        if (submit.isConnected) await user.click(submit);
        else if (opener.isConnected) await user.click(opener);
        expect(io.archive).toHaveBeenCalledTimes(1);
        io.data = {
          ...page([row(secondId, "Remaining row")]),
          capabilities: { create: canCreate, filterOwners: false },
        };
        await act(async () => {
          held.resolve({ ok: true, value: { ...saved(), archivedAt: new Date() } });
          await held.promise;
        });
        mounted.rerender(view("en", canCreate));
        await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
        expect(opener.isConnected).toBe(false);
        await waitFor(() =>
          expect([
            screen.getByRole("searchbox"),
            screen.getByRole("link", { name: /Remaining row/ }),
            screen.getByRole("heading", { name: english.title }),
          ]).toContain(document.activeElement),
        );
      } finally {
        await act(async () => {
          held.resolve({ ok: true, value: saved() });
          await held.promise;
        });
      }
    },
  );

  it("returns focus to the exact retained row trigger after Escape without writing", async () => {
    const user = userEvent.setup();
    render(view());
    const opener = await command(user, "Duplicate workflow");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(io.duplicate).not.toHaveBeenCalled();
  });

  it.each(locales)(
    "maps returned conflicts locally and keeps the duplicate name in $locale",
    async ({ locale, messages, duplicate }) => {
      io.duplicate.mockResolvedValue({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
      const user = userEvent.setup();
      render(view(locale));
      // The row trigger is localized independently; find its name-bearing accessible label.
      const trigger = screen.getByRole("button", { name: new RegExp(row().name) });
      await user.click(trigger);
      await user.click(await screen.findByRole("menuitem", { name: duplicate }));
      const dialog = await screen.findByRole("dialog");
      const name = within(dialog).getByRole("textbox");
      await user.clear(name);
      await user.type(name, "Keep this copy name");
      await user.click(within(dialog).getByRole("button", { name: duplicate }));
      expect(await screen.findByRole("alert")).toHaveTextContent(messages.conflict);
      expect(name).toHaveValue("Keep this copy name");
      expect(io.push).not.toHaveBeenCalled();
    },
  );

  it("distinguishes safe-copy refusal from an unknown commit outcome without automatic replay", async () => {
    io.duplicate.mockResolvedValueOnce({
      ok: false,
      error: ERROR_IDS.WORKFLOW_NOT_READY,
      reason: "copy-unavailable",
    });
    const user = userEvent.setup();
    render(view());
    await command(user, "Duplicate workflow");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Duplicate workflow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be copied safely");
    expect(screen.queryByText(english.notReady)).not.toBeInTheDocument();
    io.duplicate.mockRejectedValueOnce(new Error("private response lost"));
    await user.click(within(dialog).getByRole("button", { name: "Duplicate workflow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm");
    expect(io.duplicate).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("private response lost")).not.toBeInTheDocument();
    expect(io.push).not.toHaveBeenCalled();
  });

  it.each([
    { code: ERROR_IDS.WORKFLOW_DENIED, message: english.denied },
    { code: ERROR_IDS.WORKFLOW_INVALID, message: "Check the workflow name and try again." },
  ])("maps $code without raw backend output or navigation", async ({ code, message }) => {
    io.duplicate.mockResolvedValue({ ok: false, error: code });
    const user = userEvent.setup();
    render(view());
    await command(user, "Duplicate workflow");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Duplicate workflow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText(code)).not.toBeInTheDocument();
    expect(io.duplicate).toHaveBeenCalledTimes(1);
    expect(io.push).not.toHaveBeenCalled();
  });
});
