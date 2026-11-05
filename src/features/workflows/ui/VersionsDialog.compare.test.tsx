// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowDefinition } from "../schemas";
import { VersionsDialog } from "./VersionsDialog";

type Version = RouterOutputs["workflows"]["version"];
type Summary = RouterOutputs["workflows"]["versions"][number];
type Input = { id: string; versionNumber: number };
type ReadState = {
  data: Version | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
};
const io = vi.hoisted(() => ({
  summaries: [] as Summary[],
  summariesError: false,
  summariesFetching: false,
  states: new Map<string, ReadState>(),
  requests: vi.fn<(input: Input, options: unknown) => void>(),
  listRequests: vi.fn<(input: { id: string }, options: unknown) => void>(),
  refetch: vi.fn<(input: Input) => Promise<{ data: Version | undefined; isError: boolean }>>(),
  listRefetch: vi.fn<() => Promise<unknown>>(),
  restore: vi.fn<(versionNumber: number) => void>(),
  close: vi.fn<() => void>(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    workflows: {
      versions: {
        useQuery: (input: { id: string }, options: unknown) => {
          io.listRequests(input, options);
          return {
            data: io.summaries,
            isLoading: false,
            isFetching: io.summariesFetching,
            isError: io.summariesError,
            isPlaceholderData: false,
            refetch: io.listRefetch,
          };
        },
      },
      version: {
        useQuery: (input: Input, options: unknown) => {
          io.requests(input, options);
          return {
            ...io.states.get(`${input.id}:${input.versionNumber}`),
            refetch: () => io.refetch(input),
          };
        },
      },
    },
  },
}));
vi.mock("@/lib/useFormatters", () => ({
  useFormatters: () => ({ dateTime: () => "2026-11-05", number: String }),
}));
vi.mock("./BuilderWorkspace", () => ({
  BuilderWorkspace: ({
    definition,
    editable,
  }: {
    definition: WorkflowDefinition;
    editable: boolean;
  }) => (
    <div data-testid="version-preview" data-editable={String(editable)}>
      {definition.nodes.map((node) => (
        <p key={node.id}>{node.name}</p>
      ))}
    </div>
  ),
}));

const workflowId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const otherWorkflowId = "be010c39-c614-4924-a7bf-c5d16b768206";
const firstId = "617c04ad-c7b6-4a6e-9ca2-146499bf4b38";
const secondId = "c2bfa212-cd65-43e8-a562-7571b170b378";
const secretKey = "CONFIGURATION_KEY_NOT_FOR_COMPARISON";
const secretValue = "CONFIGURATION_VALUE_NOT_FOR_COMPARISON";
const locales = [
  {
    locale: "en",
    messages: english,
    selector: "Compare with published version",
    title: "Published version comparison",
  },
  {
    locale: "de",
    messages: german,
    selector: "Mit veröffentlichter Version vergleichen",
    title: "Vergleich veröffentlichter Versionen",
  },
  {
    locale: "fa",
    messages: persian,
    selector: "مقایسه با نسخهٔ منتشرشده",
    title: "مقایسهٔ نسخه‌های منتشرشده",
  },
] as const;

function definition(name: string, value: string): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name, config: { [secretKey]: value } },
    ],
    edges: [],
    layout: { start: { x: 0, y: 0 } },
  };
}
function state(data: Version): ReadState {
  return { data, isLoading: false, isFetching: false, isError: false, isPlaceholderData: false };
}
function view({
  id = workflowId,
  locale = "en",
  canRestore = true,
  pending = false,
}: {
  id?: string;
  locale?: "en" | "de" | "fa";
  canRestore?: boolean;
  pending?: boolean;
} = {}) {
  return (
    <LocaleProvider locale={locale}>
      <VersionsDialog
        workflowId={id}
        revision={7}
        canRestore={canRestore}
        pending={pending}
        error={null}
        onRestore={io.restore}
        onClose={io.close}
        onCloseAutoFocus={() => undefined}
      />
    </LocaleProvider>
  );
}
async function selectCurrent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Current publication/ }));
}
async function compare(
  user: ReturnType<typeof userEvent.setup>,
  label: string = locales[0].selector,
  number = 1,
) {
  await selectCurrent(user);
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(
    screen.getByRole("option", {
      name: number === 1 ? /Earlier publication/ : /Current publication/,
    }),
  );
}
function comparison() {
  return screen.getByRole("region", { name: locales[0].title });
}
beforeEach(() => {
  vi.clearAllMocks();
  io.summaries = [
    {
      id: secondId,
      number: 2,
      name: "Current publication",
      createdAt: new Date("2026-11-04T12:00:00Z"),
    },
    {
      id: firstId,
      number: 1,
      name: "Earlier publication",
      createdAt: new Date("2026-11-03T12:00:00Z"),
    },
  ];
  io.summariesError = false;
  io.summariesFetching = false;
  io.states.clear();
  io.states.set(
    `${workflowId}:1`,
    state({ ...io.summaries[1]!, definition: definition("Earlier step", "old-value") }),
  );
  io.states.set(
    `${workflowId}:2`,
    state({ ...io.summaries[0]!, definition: definition("Current step", secretValue) }),
  );
  io.refetch.mockReset().mockImplementation((input) =>
    Promise.resolve({
      data: io.states.get(`${input.id}:${input.versionNumber}`)?.data,
      isError: false,
    }),
  );
  io.listRefetch.mockReset().mockResolvedValue({ data: io.summaries, isError: false });
});
afterEach(cleanup);

describe("published-version comparison", () => {
  it.each(locales)(
    "offers a read-only named comparison in $locale without configuration contents",
    async ({ locale, selector, title }) => {
      const user = userEvent.setup();
      render(view({ locale, canRestore: false }));
      await compare(user, selector);
      const region = screen.getByRole("region", { name: title });
      expect(region).toHaveTextContent("Earlier step");
      expect(region).toHaveTextContent("Current step");
      expect(region.innerHTML).not.toContain(secretKey);
      expect(region.innerHTML).not.toContain(secretValue);
      expect(region.querySelector("input, textarea")).toBeNull();
      expect(screen.queryByTestId("version-preview")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: /Restore as draft|Als Entwurf wiederherstellen|بازیابی به‌عنوان پیش‌نویس/,
        }),
      ).not.toBeInTheDocument();
      expect(io.restore).not.toHaveBeenCalled();
    },
  );

  it("keeps the existing preview read-only without changing configuration or restoring", async () => {
    const user = userEvent.setup();
    render(view({ canRestore: false }));
    await selectCurrent(user);
    expect(screen.getByTestId("version-preview")).toHaveAttribute("data-editable", "false");
    expect(screen.getByTestId("version-preview")).toHaveTextContent("Current step");
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("keeps the original version as the restore target when comparison selection changes", async () => {
    const user = userEvent.setup();
    render(view());
    await compare(user);
    await user.click(screen.getByRole("button", { name: english.restoreAsDraft }));
    expect(io.restore).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("does not call restore when the existing history dialog closes", async () => {
    const user = userEvent.setup();
    render(view());
    await selectCurrent(user);
    await user.keyboard("{Escape}");
    expect(io.close).toHaveBeenCalledTimes(1);
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("resets the published selection on workflow identity change before old data can render", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await selectCurrent(user);
    const oldRead = io.states.get(`${workflowId}:2`);
    if (oldRead === undefined) throw new Error("Version fixture missing");
    io.states.set(`${otherWorkflowId}:2`, oldRead);
    rendered.rerender(view({ id: otherWorkflowId }));
    expect(screen.queryByTestId("version-preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: english.restoreAsDraft })).not.toBeInTheDocument();
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("hides the comparison while either exact version revalidates", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await compare(user);
    const previous = io.states.get(`${workflowId}:1`);
    if (previous === undefined) throw new Error("Version fixture missing");
    io.states.set(`${workflowId}:1`, { ...previous, isFetching: true });
    rendered.rerender(view());
    expect(comparison()).not.toHaveTextContent("Earlier step");
    expect(comparison()).not.toHaveTextContent("Current step");
    expect(within(comparison()).getByRole("status")).toBeVisible();
  });

  it("withholds cached comparison contents after a denied exact-version revalidation", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await compare(user);
    const previous = io.states.get(`${workflowId}:1`);
    if (previous === undefined) throw new Error("Version fixture missing");
    io.states.set(`${workflowId}:1`, { ...previous, isError: true });
    rendered.rerender(view());
    expect(comparison()).not.toHaveTextContent("Earlier step");
    expect(comparison()).not.toHaveTextContent("Current step");
    expect(within(comparison()).getByRole("alert")).toBeVisible();
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("rejects out-of-order version numbers and mismatched published IDs", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await compare(user);
    const previous = io.states.get(`${workflowId}:1`);
    if (previous?.data === undefined) throw new Error("Version fixture missing");
    io.states.set(`${workflowId}:1`, { ...previous, data: { ...previous.data, number: 2 } });
    rendered.rerender(view());
    expect(comparison()).not.toHaveTextContent("Earlier step");
    io.states.set(`${workflowId}:1`, { ...previous, data: { ...previous.data, id: secondId } });
    rendered.rerender(view());
    expect(comparison()).not.toHaveTextContent("Earlier step");
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("hides the comparison during a summary read failure and retries without a write", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await compare(user);
    io.summariesError = true;
    rendered.rerender(view());
    expect(comparison()).not.toHaveTextContent("Earlier step");
    await user.click(within(comparison()).getByRole("button", { name: english.retry }));
    expect(io.listRefetch).toHaveBeenCalledTimes(1);
    expect(io.refetch).toHaveBeenCalledWith({ id: workflowId, versionNumber: 1 });
    expect(io.refetch).toHaveBeenCalledWith({ id: workflowId, versionNumber: 2 });
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("keeps comparison selection and restore disabled during a pending restore", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await compare(user);
    rendered.rerender(view({ pending: true }));
    expect(screen.getByRole("combobox", { name: locales[0].selector })).toBeDisabled();
    expect(screen.getByRole("button", { name: english.restoreAsDraft })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: english.restoreAsDraft }));
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("requires fresh local query options without changing the global query policy", async () => {
    const user = userEvent.setup();
    render(view());
    await compare(user);
    expect(io.listRequests).toHaveBeenCalledWith(
      { id: workflowId },
      expect.objectContaining({ staleTime: 0, refetchOnMount: "always" }),
    );
    expect(io.requests).toHaveBeenCalledWith(
      { id: workflowId, versionNumber: 1 },
      expect.objectContaining({ enabled: true, staleTime: 0, refetchOnMount: "always" }),
    );
    expect(io.requests).toHaveBeenCalledWith(
      { id: workflowId, versionNumber: 2 },
      expect.objectContaining({ enabled: true, staleTime: 0, refetchOnMount: "always" }),
    );
  });

  it("shows an unchanged summary for the same published version", async () => {
    const user = userEvent.setup();
    render(view());
    await compare(user, locales[0].selector, 2);
    expect(within(comparison()).getByRole("status")).toHaveTextContent(
      english.versionCompareUnchanged,
    );
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("returns to the same read-only version when comparison is cleared", async () => {
    const user = userEvent.setup();
    render(view());
    await compare(user);
    await user.click(screen.getByRole("combobox", { name: locales[0].selector }));
    await user.click(screen.getByRole("option", { name: english.versionCompareSingle }));
    expect(screen.queryByRole("region", { name: locales[0].title })).not.toBeInTheDocument();
    expect(screen.getByTestId("version-preview")).toHaveTextContent("Current step");
    expect(screen.getByTestId("version-preview")).toHaveAttribute("data-editable", "false");
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("clears the comparison when the primary publication changes", async () => {
    const user = userEvent.setup();
    render(view());
    await compare(user);
    await user.click(screen.getByRole("button", { name: /Earlier publication/ }));
    expect(screen.queryByRole("region", { name: locales[0].title })).not.toBeInTheDocument();
    expect(screen.getByTestId("version-preview")).toHaveTextContent("Earlier step");
    await user.click(screen.getByRole("button", { name: english.restoreAsDraft }));
    expect(io.restore).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("drops both comparison selections on a workflow switch even if old results remain cached", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await compare(user);
    for (const number of [1, 2]) {
      const previous = io.states.get(`${workflowId}:${number}`);
      if (previous === undefined) throw new Error("Version fixture missing");
      io.states.set(`${otherWorkflowId}:${number}`, previous);
    }
    rendered.rerender(view({ id: otherWorkflowId }));
    expect(screen.queryByRole("region", { name: locales[0].title })).not.toBeInTheDocument();
    expect(screen.queryByTestId("version-preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: locales[0].selector })).not.toBeInTheDocument();
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("shows a newly selected ready pair while a superseded exact-version retry remains pending", async () => {
    const newer = {
      id: "9491b1f3-feca-4b50-b71c-7a686f5d9076",
      number: 3,
      name: "Newer publication",
      createdAt: new Date("2026-11-05T12:00:00Z"),
    };
    io.summaries.unshift(newer);
    io.states.set(
      `${workflowId}:3`,
      state({ ...newer, definition: definition("Newer step", "newer-value") }),
    );
    const user = userEvent.setup();
    const rendered = render(view());
    await compare(user);
    const first = io.states.get(`${workflowId}:1`);
    if (first?.data === undefined) throw new Error("Version fixture missing");
    io.states.set(`${workflowId}:1`, { ...first, isError: true });
    rendered.rerender(view());
    let resolve!: (value: { data: Version; isError: boolean }) => void;
    const held = new Promise<{ data: Version; isError: boolean }>((finish) => {
      resolve = finish;
    });
    io.refetch.mockImplementation((input) =>
      input.versionNumber === 1
        ? held
        : Promise.resolve({
            data: io.states.get(`${input.id}:${input.versionNumber}`)?.data,
            isError: false,
          }),
    );
    try {
      await user.click(within(comparison()).getByRole("button", { name: english.retry }));
      expect(io.listRefetch).toHaveBeenCalledTimes(1);
      expect(within(comparison()).getByRole("status")).toBeVisible();
      await user.click(screen.getByRole("button", { name: /Newer publication/ }));
      await user.click(screen.getByRole("combobox", { name: locales[0].selector }));
      await user.click(screen.getByRole("option", { name: /Current publication/ }));
      expect(comparison()).toHaveTextContent("Current step");
      expect(comparison()).toHaveTextContent("Newer step");
      expect(comparison()).not.toHaveTextContent("Earlier step");
      expect(within(comparison()).queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: english.restoreAsDraft })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: english.restoreAsDraft }));
      expect(io.restore).toHaveBeenCalledExactlyOnceWith(3);
    } finally {
      await act(async () => {
        resolve({ data: first.data!, isError: true });
        await held;
      });
    }
  });

  it("keeps a partial retry unavailable until both exact reads are successful", async () => {
    const user = userEvent.setup();
    const rendered = render(view());
    await compare(user);
    const first = io.states.get(`${workflowId}:1`);
    const second = io.states.get(`${workflowId}:2`);
    if (first?.data === undefined || second === undefined)
      throw new Error("Version fixture missing");
    io.states.set(`${workflowId}:1`, { ...first, isError: true });
    rendered.rerender(view());
    let resolve!: (value: { data: Version; isError: boolean }) => void;
    const held = new Promise<{ data: Version; isError: boolean }>((finish) => {
      resolve = finish;
    });
    io.refetch.mockImplementation((input) =>
      input.versionNumber === 1 ? held : Promise.resolve({ data: second.data, isError: false }),
    );
    await user.click(within(comparison()).getByRole("button", { name: english.retry }));
    expect(within(comparison()).getByRole("status")).toBeVisible();
    expect(comparison()).not.toHaveTextContent("Earlier step");
    io.states.set(`${workflowId}:1`, first);
    io.states.set(`${workflowId}:2`, { ...second, isError: true });
    await act(async () => {
      resolve({ data: first.data!, isError: false });
      await held;
    });
    rendered.rerender(view());
    expect(within(comparison()).getByRole("alert")).toBeVisible();
    expect(comparison()).not.toHaveTextContent("Earlier step");
    io.states.set(`${workflowId}:2`, second);
    rendered.rerender(view());
    expect(comparison()).toHaveTextContent("Earlier step");
    expect(comparison()).toHaveTextContent("Current step");
    expect(io.restore).not.toHaveBeenCalled();
  });

  it("reports malformed retained versions without rendering submitted error contents", async () => {
    const first = io.states.get(`${workflowId}:1`);
    if (first?.data === undefined) throw new Error("Version fixture missing");
    Object.defineProperty(first.data.definition.nodes[0]!.config, secretKey, {
      enumerable: true,
      get: () => {
        throw new Error(secretValue);
      },
    });
    const user = userEvent.setup();
    render(view());
    await compare(user);
    expect(within(comparison()).getByRole("alert")).toHaveTextContent(
      english.versionCompareUnavailable,
    );
    expect(comparison().innerHTML.includes(secretKey)).toBe(false);
    expect(comparison().innerHTML.includes(secretValue)).toBe(false);
    expect(screen.queryByTestId("version-preview")).not.toBeInTheDocument();
    expect(io.restore).not.toHaveBeenCalled();
  });
});
