// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowDetail } from "./useWorkflowEditor";
import { WorkflowEditor } from "./WorkflowEditor";

type Mode = "simulation" | "live";
type RunInput = { workflowId: string; requestKey: string; recordId: string; mode: Mode };
type RunReply = { ok: true; value: { id: string } } | { ok: false; error: string };

const calls = vi.hoisted(() => ({
  run: vi.fn<(input: RunInput, token: string | null) => Promise<RunReply>>(),
  invalidate: vi.fn<(input: { id: string }) => Promise<void>>(),
  save: vi.fn(),
  publish: vi.fn(),
  pause: vi.fn(),
}));

const workflowId = "0a2e900b-20fa-4f3a-91c2-2e8936ceee29";
const recordId = "24f51ed4-113b-4086-b4fd-a9e8a17e6214";
const acknowledgedRunId = "53719a17-7044-4092-8629-6f1497d4d5c4";
const recordName = "Acme Europe — selected existing deal";
const locales = [
  { locale: "en", messages: english },
  { locale: "de", messages: german },
  { locale: "fa", messages: persian },
] as const;

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ workflows: { runs: { invalidate: calls.invalidate } } }),
    search: {
      query: {
        useQuery: (_input: { q: string }, options: { enabled: boolean }) => ({
          data: { deals: options.enabled ? [{ id: recordId, primary: recordName }] : [] },
          isFetching: false,
          isError: false,
        }),
      },
    },
  },
}));
vi.mock("../actions", () => ({
  runWorkflowAction: calls.run,
  saveWorkflowAction: calls.save,
  publishWorkflowAction: calls.publish,
  pauseWorkflowAction: calls.pause,
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("./BuilderWorkspace", () => ({ BuilderWorkspace: () => <div>Configuration fixture</div> }));
vi.mock("./RunHistory", () => ({ RunHistory: () => <div>Run history fixture</div> }));

function initial(active = true, canRun = true): WorkflowDetail {
  return {
    id: workflowId,
    ownerId: "c5fdc435-a3f8-4108-84e9-5d5ced7e4d44",
    name: "Synthetic workflow",
    revision: 1,
    draft: initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" }),
    active,
    publishedNumber: active ? 1 : null,
    archivedAt: null,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    capabilities: { edit: true, publish: true, run: canRun, cancel: true },
  };
}

function mount(locale: "en" | "de" | "fa" = "en", active = true, canRun = true) {
  return render(
    <LocaleProvider locale={locale}>
      <WorkflowEditor initial={initial(active, canRun)} />
    </LocaleProvider>,
  );
}

async function chooseRecord(
  user: ReturnType<typeof userEvent.setup>,
  messages: typeof english,
  mode: Mode,
) {
  await user.click(
    screen.getByRole("button", {
      name: mode === "simulation" ? messages.simulation : messages.live,
    }),
  );
  const dialog = screen.getByRole("dialog", { name: messages.runTitle });
  expect(within(dialog).getByText(messages.publishedHint)).toBeVisible();
  const confirm = within(dialog).getByRole("button", {
    name: mode === "simulation" ? messages.confirmSimulation : messages.confirmLive,
  });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole("textbox", { name: messages.search }), "Acme");
  await user.click(within(dialog).getByRole("combobox", { name: messages.deal }));
  await user.click(screen.getByRole("option", { name: recordName }));
  expect(confirm).toBeEnabled();
  return { dialog, confirm };
}

function expectRunPayload(mode: Mode, times: number) {
  expect(calls.run).toHaveBeenCalledTimes(times);
  expect(calls.run).toHaveBeenLastCalledWith(
    {
      workflowId,
      requestKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ),
      recordId,
      mode,
    },
    "csrf",
  );
  expect(calls.save).not.toHaveBeenCalled();
  expect(calls.publish).not.toHaveBeenCalled();
  expect(calls.pause).not.toHaveBeenCalled();
}

async function expectSubmitted(messages: typeof english) {
  expect(screen.queryByRole("dialog", { name: messages.runTitle })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(messages.runStarted);
  expect(screen.queryByText(messages.runError)).not.toBeInTheDocument();
  expect(screen.queryByText(messages.status.succeeded)).not.toBeInTheDocument();
  const runs = screen.getByRole("tab", { name: messages.runs });
  expect(runs).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("Run history fixture")).toBeVisible();
  await waitFor(() => expect(runs).toHaveFocus());
}

beforeEach(() => {
  calls.run.mockReset();
  calls.invalidate.mockReset();
  calls.save.mockReset();
  calls.publish.mockReset();
  calls.pause.mockReset();
  calls.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

for (const mode of ["simulation", "live"] as const) {
  for (const failure of ["synchronous", "rejected"] as const) {
    it.each(locales)(
      `preserves submitted ${mode} after ${failure} invalidation in $locale`,
      async ({ locale, messages }) => {
        let acknowledge!: (reply: RunReply) => void;
        const acknowledgement = new Promise<RunReply>((resolve) => {
          acknowledge = resolve;
        });
        calls.run.mockReturnValueOnce(acknowledgement);
        if (failure === "synchronous") {
          calls.invalidate.mockImplementationOnce(() => {
            throw new Error("history cache unavailable");
          });
        } else {
          calls.invalidate.mockRejectedValueOnce(new Error("history cache unavailable"));
        }
        const user = userEvent.setup();
        mount(locale);
        const { dialog, confirm } = await chooseRecord(user, messages, mode);

        await user.click(confirm);

        expectRunPayload(mode, 1);
        expect(confirm).toBeDisabled();
        expect(within(dialog).getByRole("textbox", { name: messages.search })).toBeDisabled();
        expect(within(dialog).getByRole("combobox", { name: messages.deal })).toBeDisabled();
        expect(calls.invalidate).not.toHaveBeenCalled();
        await user.click(confirm);
        expectRunPayload(mode, 1);

        await act(() => {
          acknowledge({ ok: true, value: { id: acknowledgedRunId } });
          return Promise.resolve();
        });

        if (confirm.isConnected) expect(confirm).toBeEnabled();
        expect(screen.queryByRole("dialog", { name: messages.runTitle })).not.toBeInTheDocument();
        expectRunPayload(mode, 1);
        expect(calls.invalidate).toHaveBeenCalledTimes(1);
        expect(calls.invalidate).toHaveBeenCalledWith({ id: workflowId });
        await expectSubmitted(messages);
      },
    );
  }

  it.each(["failed result", "rejection"] as const)(
    `preserves a genuine ${mode} action %s and retries the same request identity`,
    async (failure) => {
      if (failure === "failed result") {
        calls.run.mockResolvedValueOnce({ ok: false, error: "E_WORKFLOW_001" });
      } else {
        calls.run.mockRejectedValueOnce(new Error("run request unavailable"));
      }
      const user = userEvent.setup();
      mount();
      const { dialog, confirm } = await chooseRecord(user, english, mode);

      await user.click(confirm);
      await waitFor(() => expect(confirm).toBeEnabled());

      expect(screen.getByRole("dialog", { name: english.runTitle })).toBe(dialog);
      expect(within(dialog).getByRole("alert")).toHaveTextContent(english.runError);
      expect(within(dialog).getByRole("textbox", { name: english.search })).toHaveValue("Acme");
      expect(within(dialog).getByRole("combobox", { name: english.deal })).toHaveTextContent(
        recordName,
      );
      expectRunPayload(mode, 1);
      expect(calls.invalidate).not.toHaveBeenCalled();
      expect(screen.queryByText(english.runStarted)).not.toBeInTheDocument();
      const firstRequest = calls.run.mock.calls[0];
      let acknowledgeRetry!: (reply: RunReply) => void;
      calls.run.mockReturnValueOnce(
        new Promise<RunReply>((resolve) => {
          acknowledgeRetry = resolve;
        }),
      );

      await user.click(confirm);
      expectRunPayload(mode, 2);
      expect(calls.run.mock.calls[1]).toEqual(firstRequest);
      expect(confirm).toBeDisabled();
      await act(() => {
        acknowledgeRetry({ ok: true, value: { id: acknowledgedRunId } });
        return Promise.resolve();
      });

      expectRunPayload(mode, 2);
      expect(calls.invalidate).toHaveBeenCalledTimes(1);
      expect(calls.invalidate).toHaveBeenCalledWith({ id: workflowId });
      await expectSubmitted(english);
    },
  );
}

it.each([
  { active: false, canRun: true },
  { active: true, canRun: false },
])("preserves run gates with active=$active and permission=$canRun", ({ active, canRun }) => {
  mount("en", active, canRun);

  expect(screen.getByRole("button", { name: english.simulation })).toBeDisabled();
  expect(screen.getByRole("button", { name: english.live })).toBeDisabled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls.run).not.toHaveBeenCalled();
  expect(calls.invalidate).not.toHaveBeenCalled();
});
