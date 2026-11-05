// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { publishWorkflowAction } from "../actions";
import { initialBlankDefinition } from "../editorModel";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowDefinition } from "../schemas";
import type { WorkflowDetail } from "./useWorkflowEditor";
import { WorkflowEditor } from "./WorkflowEditor";

const io = vi.hoisted(() => ({
  save: vi.fn(),
  publish: vi.fn<typeof publishWorkflowAction>(),
  pause: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  duplicate: vi.fn(),
  restore: vi.fn(),
  cancel: vi.fn(),
  run: vi.fn(),
  retry: vi.fn(),
  invalidate: vi.fn(),
  currentRead: vi.fn<() => Promise<WorkflowDetail>>(),
  push: vi.fn(),
  refresh: vi.fn(),
  changeGraph: undefined as Dispatch<SetStateAction<WorkflowDefinition>> | undefined,
}));
vi.mock("../actions", () => ({
  saveWorkflowAction: io.save,
  publishWorkflowAction: io.publish,
  pauseWorkflowAction: io.pause,
  archiveWorkflowAction: io.archive,
  unarchiveWorkflowAction: io.unarchive,
  duplicateWorkflowAction: io.duplicate,
  restoreWorkflowDraftAction: io.restore,
  cancelWorkflowAction: io.cancel,
  runWorkflowAction: io.run,
  retryWorkflowAction: io.retry,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      workflows: {
        get: { invalidate: io.invalidate, fetch: io.currentRead },
        list: { invalidate: io.invalidate },
        versions: { invalidate: io.invalidate },
        runs: { invalidate: io.invalidate },
      },
    }),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: io.push, refresh: io.refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "publish-review-csrf" }));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows/review",
}));
vi.mock("./BuilderWorkspace", () => ({
  BuilderWorkspace: ({
    definition,
    onChange,
  }: {
    definition: WorkflowDefinition;
    onChange: Dispatch<SetStateAction<WorkflowDefinition>>;
  }) => {
    io.changeGraph = onChange;
    return <div>{definition.nodes.map((node) => node.name).join(", ")}</div>;
  },
}));
vi.mock("./RunHistory", () => ({ RunHistory: () => <p>History fixture</p> }));

const workflowId = "5089f280-1df3-4c62-9a0f-c3a2a679f1da";
const ownerId = "b813ff7e-1cff-4d61-a776-88a4d04ca211";
const versionId = "37fdbcc9-7855-4861-ac38-30cb462f0d4b";
const locales = [
  { locale: "en", copy: english, title: "Review publication", confirm: "Publish this version" },
  {
    locale: "de",
    copy: german,
    title: "Veröffentlichung prüfen",
    confirm: "Diese Version veröffentlichen",
  },
  { locale: "fa", copy: persian, title: "بازبینی انتشار", confirm: "انتشار این نسخه" },
] as const;
function fixture(): WorkflowDetail {
  return {
    id: workflowId,
    ownerId,
    name: "Reviewed workflow",
    revision: 7,
    draft: initialBlankDefinition("Manual start"),
    active: false,
    publishedNumber: null,
    archivedAt: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-04T00:00:00Z"),
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
function view(initial = fixture(), locale: "en" | "de" | "fa" = "en") {
  return (
    <LocaleProvider locale={locale}>
      <WorkflowEditor initial={initial} />
    </LocaleProvider>
  );
}
function publication(): Awaited<ReturnType<typeof publishWorkflowAction>> {
  return {
    ok: true,
    value: {
      id: versionId,
      workflowId,
      number: 1,
      name: fixture().name,
      definition: fixture().draft,
      publishedBy: ownerId,
      createdAt: new Date("2026-11-05T00:00:00Z"),
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
async function openReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: english.publish }));
  return screen.getByRole("alertdialog", { name: "Review publication" });
}
beforeEach(() => {
  vi.clearAllMocks();
  io.changeGraph = undefined;
  io.save
    .mockReset()
    .mockImplementation(
      (input: { name: string; definition: WorkflowDefinition; revision: number }) =>
        Promise.resolve({
          ok: true,
          value: {
            ...fixture(),
            name: input.name,
            draft: input.definition,
            revision: input.revision + 1,
          },
        }),
    );
  io.publish.mockReset().mockResolvedValue(publication());
  io.invalidate.mockReset().mockResolvedValue(undefined);
  io.currentRead.mockReset().mockResolvedValue(fixture());
});
afterEach(cleanup);

describe("publication review on the actual editor", () => {
  it.each(locales)(
    "opens a localized accessible review before any write in $locale",
    async ({ locale, copy, title, confirm }) => {
      const user = userEvent.setup();
      render(view(fixture(), locale));
      await user.click(screen.getByRole("button", { name: copy.publish }));
      expect(io.publish).not.toHaveBeenCalled();
      expect(io.save).not.toHaveBeenCalled();
      const dialog = screen.getByRole("alertdialog", { name: title });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(within(dialog).getByText("Reviewed workflow")).toBeVisible();
      expect(within(dialog).getByText("Manual start")).toBeVisible();
      expect(within(dialog).getByRole("button", { name: confirm })).toBeEnabled();
      expect(within(dialog).getByRole("button", { name: copy.cancel })).toBeEnabled();
      expect(io.run).not.toHaveBeenCalled();
    },
  );

  it("cancels without saving or publishing a dirty draft", async () => {
    const user = userEvent.setup();
    render(view());
    await user.clear(screen.getByRole("textbox", { name: english.name }));
    await user.type(screen.getByRole("textbox", { name: english.name }), "Local reviewed name");
    const dialog = await openReview(user);
    expect(within(dialog).getByText("Local reviewed name")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: english.cancel }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: english.name })).toHaveValue("Local reviewed name");
  });

  it("dismisses with Escape and returns focus to Publish without writes", async () => {
    const user = userEvent.setup();
    render(view());
    const opener = screen.getByRole("button", { name: english.publish });
    opener.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alertdialog", { name: "Review publication" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(io.save).not.toHaveBeenCalled();
    expect(io.publish).not.toHaveBeenCalled();
  });

  it("saves a reviewed dirty cut before publishing its acknowledged revision once", async () => {
    const user = userEvent.setup();
    render(view());
    fireEvent.change(screen.getByRole("textbox", { name: english.name }), {
      target: { value: "Reviewed local name" },
    });
    const dialog = await openReview(user);
    expect(io.save).not.toHaveBeenCalled();
    expect(io.publish).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Publish this version" }));
    await waitFor(() =>
      expect(io.publish).toHaveBeenCalledExactlyOnceWith(workflowId, 8, "publish-review-csrf"),
    );
    expect(io.save).toHaveBeenCalledExactlyOnceWith(
      { id: workflowId, name: "Reviewed local name", definition: fixture().draft, revision: 7 },
      "publish-review-csrf",
    );
    expect(io.save.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      io.publish.mock.invocationCallOrder[0] ?? -Infinity,
    );
    expect(screen.getByRole("status")).toHaveTextContent(english.published);
  });

  it("confirms clean publish-only rights without an editor save", async () => {
    const initial = fixture();
    initial.capabilities.edit = false;
    initial.capabilities.restore = false;
    const user = userEvent.setup();
    render(view(initial));
    expect(screen.queryByRole("button", { name: english.save })).not.toBeInTheDocument();
    const dialog = await openReview(user);
    expect(io.publish).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Publish this version" }));
    await waitFor(() =>
      expect(io.publish).toHaveBeenCalledExactlyOnceWith(workflowId, 7, "publish-review-csrf"),
    );
    expect(io.save).not.toHaveBeenCalled();
  });

  it("does not send another publication while the first confirmation is in flight", async () => {
    const response = deferred<Awaited<ReturnType<typeof publishWorkflowAction>>>();
    io.publish.mockReturnValueOnce(response.promise);
    const user = userEvent.setup();
    render(view());
    const dialog = await openReview(user);
    const confirm = within(dialog).getByRole("button", { name: "Publish this version" });
    await user.dblClick(confirm);
    expect(io.publish).toHaveBeenCalledTimes(1);
    expect(io.save).not.toHaveBeenCalled();
    await act(async () => {
      response.resolve(publication());
      await response.promise;
    });
    expect(await screen.findByRole("status")).toHaveTextContent(english.published);
  });

  it("keeps a rejected draft save from invoking publication", async () => {
    io.save.mockResolvedValueOnce({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
    const user = userEvent.setup();
    render(view());
    fireEvent.change(screen.getByRole("textbox", { name: english.name }), {
      target: { value: "Unsaved conflict" },
    });
    const dialog = await openReview(user);
    await user.click(within(dialog).getByRole("button", { name: "Publish this version" }));
    await waitFor(() => expect(io.save).toHaveBeenCalledTimes(1));
    expect(io.publish).not.toHaveBeenCalled();
    expect(screen.getByText(english.conflict)).toBeVisible();
    expect(screen.getByRole("textbox", { name: english.name })).toHaveValue("Unsaved conflict");
  });

  it("requires a new explicit review after the graph changes while review is open", async () => {
    const user = userEvent.setup();
    render(view());
    const dialog = await openReview(user);
    act(() =>
      io.changeGraph?.((definition) => ({
        ...definition,
        nodes: definition.nodes.map((node) => ({ ...node, name: "Updated manual start" })),
      })),
    );
    expect(within(dialog).getByRole("button", { name: "Publish this version" })).toBeDisabled();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.publish).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Review updated workflow" }));
    expect(within(dialog).getByText("Updated manual start")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Publish this version" }));
    await waitFor(() =>
      expect(io.publish).toHaveBeenCalledExactlyOnceWith(workflowId, 8, "publish-review-csrf"),
    );
    expect(io.save).toHaveBeenCalledTimes(1);
  });
});

describe("preserved activation and authoring controls", () => {
  it("saving a dirty inactive draft never activates or publishes it", async () => {
    const user = userEvent.setup();
    render(view());
    fireEvent.change(screen.getByRole("textbox", { name: english.name }), {
      target: { value: "Saved only" },
    });
    await user.click(screen.getByRole("button", { name: english.save }));
    await waitFor(() => expect(io.save).toHaveBeenCalledTimes(1));
    expect(io.publish).not.toHaveBeenCalled();
    expect(screen.getByText(english.draft)).toBeVisible();
    expect(screen.getByRole("button", { name: english.simulation })).toBeDisabled();
    expect(screen.getByRole("button", { name: english.live })).toBeDisabled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps invalid definitions from opening publication", () => {
    const initial = fixture();
    initial.draft = { ...initial.draft, edges: [{ from: "start", to: "missing", port: "next" }] };
    render(view(initial));
    expect(screen.getByRole("button", { name: english.publish })).toBeDisabled();
    expect(io.publish).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });

  it("keeps archived authoring unavailable even with stale publish flags", () => {
    const initial = fixture();
    initial.archivedAt = new Date("2026-11-04T00:00:00Z");
    render(view(initial));
    expect(screen.getByRole("textbox", { name: english.name })).toBeDisabled();
    expect(screen.getByRole("button", { name: english.simulation })).toBeDisabled();
    expect(screen.getByRole("button", { name: english.live })).toBeDisabled();
    expect(io.publish).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });
});
