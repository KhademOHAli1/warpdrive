// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import { initialDefinition } from "../editorModel";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import { RunDialog } from "./RunDialog";

type Mode = "simulation" | "live";
type Workflow = RouterOutputs["workflows"]["get"];
type Version = RouterOutputs["workflows"]["version"];
type VersionInput = { id: string; versionNumber: number };
type RunInput = {
  workflowId: string;
  requestKey: string;
  recordId?: string;
  mode: Mode;
  reviewedVersionId?: string;
};
type RunReply = { ok: true; value: { id: string } } | { ok: false; error: string };
type ReadState<T> = {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  isSuccess: boolean;
  status: "pending" | "success" | "error";
};

const io = vi.hoisted(() => ({
  run: vi.fn<(input: RunInput, token: string | null) => Promise<RunReply>>(),
  close: vi.fn<() => void>(),
  started: vi.fn<() => void>(),
  closeAutoFocus: vi.fn<(event: Event) => void>(),
  workflows: new Map<string, ReadState<Workflow>>(),
  versions: new Map<string, ReadState<Version>>(),
  getRequests: vi.fn<(input: { id: string }, options: unknown) => void>(),
  versionRequests: vi.fn<(input: VersionInput, options: unknown) => void>(),
  refetch: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    search: {
      query: {
        useQuery: (_input: { q: string }, options: { enabled: boolean }) => ({
          data: {
            deals: options.enabled
              ? [
                  { id: recordId, primary: recordName },
                  { id: otherRecordId, primary: otherRecordName },
                ]
              : [],
          },
          isFetching: false,
          isError: false,
        }),
      },
    },
    workflows: {
      get: {
        useQuery: (input: { id: string }, options: unknown) => {
          io.getRequests(input, options);
          return { ...io.workflows.get(input.id), refetch: io.refetch };
        },
      },
      version: {
        useQuery: (input: VersionInput, options: unknown) => {
          io.versionRequests(input, options);
          return {
            ...io.versions.get(`${input.id}:${input.versionNumber}`),
            refetch: io.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("../actions", () => ({ runWorkflowAction: io.run }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const workflowId = "6e98d5a5-dfad-4d36-b65f-269329cd71eb";
const otherWorkflowId = "2cfced9b-c658-4835-acdf-1a878b1bf038";
const firstVersionId = "0cc8aaff-48c9-47e8-b293-1038a3407412";
const secondVersionId = "0907fe21-4f80-4771-882d-4f42516b78b8";
const recordId = "ab1b4f6c-c8eb-4665-aafc-0edc1c38dbad";
const otherRecordId = "f977430c-63b3-409d-86c3-b9796a93c1cc";
const runId = "55de3baa-79d1-43f1-8f29-f4f1209b39c7";
const recordName = "Acme — selected authorized deal";
const otherRecordName = "Acme — another authorized deal";
const authoredName = "AUTHORED_NODE_NAME_NOT_FOR_EFFECT_REVIEW";
const authoredSubject = "TASK_SUBJECT_LITERAL_NOT_FOR_EFFECT_REVIEW";
const locales = [
  {
    locale: "en",
    messages: english,
    heading: "Review live effects",
    acknowledgement: "I have reviewed this live test.",
  },
  {
    locale: "de",
    messages: german,
    heading: "Live-Auswirkungen prüfen",
    acknowledgement: "Ich habe diesen Live-Test geprüft.",
  },
  {
    locale: "fa",
    messages: persian,
    heading: "بررسی اثرهای اجرای واقعی",
    acknowledgement: "این اجرای واقعی را بررسی کرده‌ام.",
  },
] as const;
type Messages = (typeof locales)[number]["messages"];

function read<T>(data: T): ReadState<T> {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isPlaceholderData: false,
    isSuccess: true,
    status: "success",
  };
}
function workflow(id = workflowId, publishedNumber = 1): Workflow {
  return {
    id,
    ownerId: "551d1a82-4d73-4df0-80b6-2758f5db5d41",
    name: "Customer follow-up",
    revision: 3,
    draft: initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Draft" }),
    active: true,
    publishedNumber,
    archivedAt: null,
    createdAt: new Date("2026-11-01T12:00:00Z"),
    updatedAt: new Date("2026-11-04T12:00:00Z"),
    capabilities: {
      edit: true,
      publish: true,
      run: true,
      cancel: true,
      unarchive: false,
      duplicate: true,
      restore: true,
    },
  };
}
function publication(number = 1, id = firstVersionId): Version {
  return {
    id,
    number,
    name: "Published customer follow-up",
    createdAt: new Date("2026-11-03T12:00:00Z"),
    definition: initialDefinition({
      start: authoredName,
      read: authoredName,
      task: authoredName,
      subject: authoredSubject,
    }),
  };
}
function view({
  id = workflowId,
  mode = "live",
  locale = "en",
}: {
  id?: string;
  mode?: Mode;
  locale?: "en" | "de" | "fa";
} = {}) {
  return (
    <LocaleProvider locale={locale}>
      <RunDialog
        workflowId={id}
        mode={mode}
        onClose={io.close}
        onStarted={io.started}
        onCloseAutoFocus={io.closeAutoFocus}
      />
    </LocaleProvider>
  );
}
async function chooseRecord(
  user: ReturnType<typeof userEvent.setup>,
  messages: Messages = english,
  name = recordName,
) {
  await user.type(screen.getByRole("textbox", { name: messages.search }), "Acme");
  await user.click(screen.getByRole("combobox", { name: messages.deal }));
  await user.click(screen.getByRole("option", { name }));
}
function confirm(messages: Messages = english) {
  return screen.getByRole("button", {
    name: (name) =>
      name === messages.confirmLive ||
      name === messages.confirmLiveRecords ||
      name === messages.confirmSimulation ||
      name === messages.retry,
  });
}
async function acknowledgeIfOffered(user: ReturnType<typeof userEvent.setup>) {
  const acknowledgement = screen.queryByRole("checkbox", {
    name: locales[0].acknowledgement,
  });
  if (acknowledgement !== null) await user.click(acknowledgement);
}
function workflowState() {
  const state = io.workflows.get(workflowId);
  if (state === undefined) throw new Error("Missing workflow fixture");
  return state;
}
function versionState() {
  const state = io.versions.get(`${workflowId}:1`);
  if (state === undefined) throw new Error("Missing publication fixture");
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  io.run.mockReset().mockResolvedValue({ ok: true, value: { id: runId } });
  io.refetch.mockReset().mockResolvedValue(undefined);
  io.workflows.clear();
  io.versions.clear();
  io.workflows.set(workflowId, read(workflow()));
  io.workflows.set(otherWorkflowId, read(workflow(otherWorkflowId, 2)));
  io.versions.set(`${workflowId}:1`, read(publication()));
  io.versions.set(`${workflowId}:2`, read(publication(2, secondVersionId)));
  io.versions.set(`${otherWorkflowId}:2`, read(publication(2, secondVersionId)));
});
afterEach(cleanup);

describe("published live-test review", () => {
  it.each(locales)(
    "pins the simulation publication without asking for a live review in $locale",
    async ({ locale, messages, acknowledgement }) => {
      const user = userEvent.setup();
      const mounted = render(view({ mode: "simulation", locale }));
      await chooseRecord(user, messages);
      expect(screen.queryByRole("checkbox", { name: acknowledgement })).not.toBeInTheDocument();
      expect(confirm(messages)).toBeEnabled();

      await user.click(confirm(messages));

      expect(io.run).toHaveBeenCalledExactlyOnceWith(
        {
          workflowId,
          requestKey: expect.any(String),
          recordId,
          mode: "simulation",
          reviewedVersionId: firstVersionId,
        },
        "csrf",
      );
      expect(io.started).toHaveBeenCalledTimes(1);
      await user.keyboard("{Escape}");
      expect(io.close).toHaveBeenCalledTimes(1);
      mounted.unmount();
      await waitFor(() => expect(io.closeAutoFocus).toHaveBeenCalledTimes(1));
    },
  );

  it.each(["simulation", "live"] as const)(
    "launches a Global publication in %s mode without a deal",
    async (mode) => {
      const current = publication();
      current.definition = {
        schemaVersion: 1,
        nodes: [
          {
            id: "start",
            type: "trigger.manual",
            version: 1,
            name: "Start",
            config: { scope: "global" },
          },
          {
            id: "create-person",
            type: "record.create",
            version: 1,
            name: "Create person",
            config: { entity: "person", fields: { name: { kind: "value", value: "Example" } } },
          },
        ],
        edges: [{ from: "start", to: "create-person", port: "next" }],
      };
      io.versions.set(`${workflowId}:1`, read(current));
      const user = userEvent.setup();
      render(view({ mode }));

      expect(screen.queryByRole("combobox", { name: english.deal })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: english.search })).not.toBeInTheDocument();
      expect(screen.getByText(english.manualGlobalRunHint)).toBeVisible();
      if (mode === "live") {
        expect(confirm()).toBeDisabled();
        await acknowledgeIfOffered(user);
      }
      expect(confirm()).toBeEnabled();
      await user.click(confirm());
      expect(io.run).toHaveBeenCalledExactlyOnceWith(
        { workflowId, requestKey: expect.any(String), mode, reviewedVersionId: firstVersionId },
        "csrf",
      );
    },
  );

  it.each(locales)(
    "requires explicit live review before submitting the displayed publication in $locale",
    async ({ locale, messages, heading, acknowledgement }) => {
      const user = userEvent.setup();
      render(view({ locale }));
      await chooseRecord(user, messages);
      expect(confirm(messages)).toBeDisabled();
      expect(io.run).not.toHaveBeenCalled();
      const region = screen.getByRole("region", { name: heading });
      expect(region).toHaveTextContent(recordName);
      expect(region).toHaveTextContent("Published customer follow-up");

      await user.click(screen.getByRole("checkbox", { name: acknowledgement }));
      expect(confirm(messages)).toBeEnabled();
      await user.click(confirm(messages));

      expect(io.run).toHaveBeenCalledExactlyOnceWith(
        {
          workflowId,
          requestKey: expect.any(String),
          recordId,
          mode: "live",
          reviewedVersionId: firstVersionId,
        },
        "csrf",
      );
      expect(io.started).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "fetching workflow",
    "denied workflow",
    "denied publication",
    "placeholder publication",
    "mismatched publication number",
    "mismatched workflow identity",
  ] as const)("withholds live confirmation for a %s", async (problem) => {
    if (problem === "fetching workflow") {
      io.workflows.set(workflowId, { ...workflowState(), isFetching: true });
    } else if (problem === "denied workflow") {
      io.workflows.set(workflowId, {
        ...workflowState(),
        isError: true,
        isSuccess: false,
        status: "error",
      });
    } else if (problem === "denied publication") {
      io.versions.set(`${workflowId}:1`, {
        ...versionState(),
        isError: true,
        isSuccess: false,
        status: "error",
      });
    } else if (problem === "placeholder publication") {
      io.versions.set(`${workflowId}:1`, { ...versionState(), isPlaceholderData: true });
    } else if (problem === "mismatched publication number") {
      io.versions.set(`${workflowId}:1`, read(publication(2, secondVersionId)));
    } else {
      io.workflows.set(workflowId, read(workflow(otherWorkflowId)));
    }
    const user = userEvent.setup();
    render(view());
    expect(screen.queryByRole("combobox", { name: english.deal })).not.toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    expect(screen.queryByRole("region", { name: locales[0].heading })).not.toBeInTheDocument();
    await user.click(confirm());
    expect(io.run).not.toHaveBeenCalled();
  });

  it("requires renewed acknowledgement after publication changes and later returns", async () => {
    const user = userEvent.setup();
    const mounted = render(view());
    await chooseRecord(user);
    await user.click(screen.getByRole("checkbox", { name: locales[0].acknowledgement }));
    expect(confirm()).toBeEnabled();

    io.workflows.set(workflowId, read(workflow(workflowId, 2)));
    mounted.rerender(view());
    expect(confirm()).toBeDisabled();
    io.workflows.set(workflowId, read(workflow()));
    mounted.rerender(view());

    expect(confirm()).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: locales[0].acknowledgement })).not.toBeChecked();
    expect(io.run).not.toHaveBeenCalled();
  });

  it("invalidates the acknowledgement when another deal is selected", async () => {
    const user = userEvent.setup();
    render(view());
    await chooseRecord(user);
    await user.click(screen.getByRole("checkbox", { name: locales[0].acknowledgement }));
    expect(confirm()).toBeEnabled();

    await user.click(screen.getByRole("combobox", { name: english.deal }));
    await user.click(screen.getByRole("option", { name: otherRecordName }));

    expect(confirm()).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: locales[0].acknowledgement })).not.toBeChecked();
    expect(screen.getByRole("region", { name: locales[0].heading })).toHaveTextContent(
      otherRecordName,
    );
    expect(io.run).not.toHaveBeenCalled();
  });

  it("invalidates the acknowledgement when the workflow identity is retargeted", async () => {
    const user = userEvent.setup();
    const mounted = render(view());
    await chooseRecord(user);
    await user.click(screen.getByRole("checkbox", { name: locales[0].acknowledgement }));
    expect(confirm()).toBeEnabled();

    mounted.rerender(view({ id: otherWorkflowId }));

    expect(confirm()).toBeDisabled();
    expect(io.run).not.toHaveBeenCalled();
  });

  for (const mode of ["simulation", "live"] as const) {
    it.each(["failed result", "rejection"] as const)(
      `retries an unchanged ${mode} command after a %s despite retargeted props`,
      async (failure) => {
        if (failure === "failed result") {
          io.run.mockResolvedValueOnce({ ok: false, error: "E_WORKFLOW_001" });
        } else {
          io.run.mockRejectedValueOnce(new Error("submission reply unavailable"));
        }
        const user = userEvent.setup();
        const mounted = render(view({ mode }));
        await chooseRecord(user);
        await acknowledgeIfOffered(user);
        await user.click(confirm());
        await waitFor(() => expect(confirm()).toBeEnabled());
        expect(io.run).toHaveBeenCalledTimes(1);
        expect(io.started).not.toHaveBeenCalled();
        const firstRequest = io.run.mock.calls[0];
        expect(firstRequest).toBeDefined();

        io.workflows.set(workflowId, read(workflow(workflowId, 2)));
        mounted.rerender(
          view({ id: otherWorkflowId, mode: mode === "live" ? "simulation" : "live" }),
        );
        let acknowledge!: (reply: RunReply) => void;
        io.run.mockReturnValueOnce(
          new Promise<RunReply>((resolve) => {
            acknowledge = resolve;
          }),
        );
        expect(io.run).toHaveBeenCalledTimes(1);
        await user.click(confirm());

        expect(io.run).toHaveBeenCalledTimes(2);
        expect(io.run.mock.calls[1]).toEqual(firstRequest);
        expect(screen.getByRole("textbox", { name: english.search })).toBeDisabled();
        expect(screen.getByRole("combobox", { name: english.deal })).toBeDisabled();
        expect(confirm()).toBeDisabled();
        await user.click(confirm());
        expect(io.run).toHaveBeenCalledTimes(2);
        await act(async () => {
          acknowledge({ ok: true, value: { id: runId } });
          await Promise.resolve();
        });
        expect(io.started).toHaveBeenCalledTimes(1);
      },
    );
  }

  it("does not submit a second command while the first acknowledgement is pending", async () => {
    let acknowledge!: (reply: RunReply) => void;
    io.run.mockReturnValueOnce(
      new Promise<RunReply>((resolve) => {
        acknowledge = resolve;
      }),
    );
    const user = userEvent.setup();
    render(view());
    await chooseRecord(user);
    await acknowledgeIfOffered(user);
    await user.click(confirm());
    expect(confirm()).toBeDisabled();
    await user.click(confirm());
    expect(io.run).toHaveBeenCalledTimes(1);
    expect(io.started).not.toHaveBeenCalled();

    await act(async () => {
      acknowledge({ ok: true, value: { id: runId } });
      await Promise.resolve();
    });
    expect(io.started).toHaveBeenCalledTimes(1);
  });

  it("renders only the bounded effect review rather than authored values or identifiers", async () => {
    const user = userEvent.setup();
    render(view());
    await chooseRecord(user);
    const region = screen.getByRole("region", { name: locales[0].heading });

    expect(region).toHaveTextContent(english.task);
    expect(region.innerHTML).not.toContain(authoredName);
    expect(region.innerHTML).not.toContain(authoredSubject);
    expect(region.innerHTML).not.toContain(workflowId);
    expect(region.innerHTML).not.toContain(firstVersionId);
    expect(region.innerHTML).not.toContain(recordId);
    expect(io.run).not.toHaveBeenCalled();
  });

  it("uses fresh dialog-local authorized workflow and exact-publication reads", async () => {
    const user = userEvent.setup();
    render(view());
    await chooseRecord(user);

    expect(io.getRequests).toHaveBeenLastCalledWith(
      { id: workflowId },
      expect.objectContaining({
        staleTime: 0,
        refetchOnMount: "always",
        placeholderData: undefined,
      }),
    );
    expect(io.versionRequests).toHaveBeenLastCalledWith(
      { id: workflowId, versionNumber: 1 },
      expect.objectContaining({
        staleTime: 0,
        refetchOnMount: "always",
        placeholderData: undefined,
      }),
    );
    expect(io.run).not.toHaveBeenCalled();
  });
});

it("keeps publication reloads independent when the same workflow is republished", async () => {
  let finishOld!: () => void;
  let finishCurrent!: () => void;
  const oldRead = new Promise<unknown>((resolve) => {
    finishOld = () => resolve(undefined);
  });
  const currentRead = new Promise<unknown>((resolve) => {
    finishCurrent = () => resolve(undefined);
  });
  io.refetch
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(oldRead)
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(currentRead);
  io.versions.set(`${workflowId}:1`, {
    ...versionState(),
    isError: true,
    isSuccess: false,
    status: "error",
  });
  const user = userEvent.setup();
  const mounted = render(view());
  await user.click(screen.getByRole("button", { name: "Reload review" }));
  await waitFor(() => expect(io.refetch).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "Reload review" })).toBeDisabled();

  io.workflows.set(workflowId, read(workflow(workflowId, 2)));
  io.versions.set(`${workflowId}:2`, {
    ...read(publication(2, secondVersionId)),
    isError: true,
    isSuccess: false,
    status: "error",
  });
  mounted.rerender(view());

  expect(screen.getByRole("button", { name: "Reload review" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Reload review" }));
  await waitFor(() => expect(io.refetch).toHaveBeenCalledTimes(4));
  expect(screen.getByRole("button", { name: "Reload review" })).toBeDisabled();

  await act(async () => {
    finishOld();
    await oldRead;
  });
  expect(screen.getByRole("button", { name: "Reload review" })).toBeDisabled();
  expect(io.run).not.toHaveBeenCalled();

  await act(async () => {
    finishCurrent();
    await currentRead;
  });
  expect(screen.getByRole("button", { name: "Reload review" })).toBeEnabled();
  expect(io.run).not.toHaveBeenCalled();
});
