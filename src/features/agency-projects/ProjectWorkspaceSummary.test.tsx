// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectStartOutcome } from "./ProjectWorkspaceSummary";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

import { deferred } from "./ProjectCreationForm.test-support";
import {
  renderWorkspace,
  workspaceIntentId,
  workspaceProjectId,
  workspaceProps,
  workspaceView,
} from "./ProjectWorkspaceSummary.test-support";

afterEach(cleanup);

describe("private project workspace read and start", () => {
  it.each([
    ["en", "Project workspace", "Planned", "Start work"],
    ["de", "Projektübersicht", "Geplant", "Arbeit starten"],
    ["fa", "نمای پروژه", "برنامه‌ریزی‌شده", "شروع کار"],
  ] as const)(
    "shows the permitted %s project with localized state and start action",
    (locale, heading, planned, start) => {
      renderWorkspace(workspaceProps(), locale);
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByText("Private Studio / استودیو")).toBeInTheDocument();
      expect(screen.getByText("Sara رضایی")).toBeInTheDocument();
      expect(screen.getByText(planned)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: start })).toHaveAttribute("type", "button");
      expect(screen.getByRole("region")).toHaveClass("ph-block-email", "ph-no-capture");
      expect(screen.queryByText(workspaceProjectId)).not.toBeInTheDocument();
    },
  );

  it.each(["read", "context", "project", "owner"] as const)(
    "hides private data when %s is unavailable",
    (kind) => {
      const props = workspaceProps();
      if (kind === "read") props.canRead = false;
      if (kind === "context") props.contextKey = "different-actor";
      if (kind === "project") props.project = null;
      if (kind === "owner") props.ownerLabel = null;
      renderWorkspace(props);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByText("Private Studio / استودیو")).not.toBeInTheDocument();
      expect(screen.queryByText("Sara رضایی")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(props.start).not.toHaveBeenCalled();
    },
  );

  it("keeps a read-only project visible without granting a start action", () => {
    renderWorkspace(workspaceProps({ canStart: false }));
    expect(screen.getByText("Private Studio / استودیو")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start work" })).not.toBeInTheDocument();
  });

  it("saves one exact start attempt before I/O and prevents duplicate clicks", () => {
    const events: string[] = [];
    const props = workspaceProps({
      onDraftChange: vi.fn(() => events.push("saved")),
      start: vi.fn(() => {
        events.push("io");
        return new Promise<ProjectStartOutcome>(() => undefined);
      }),
    });
    renderWorkspace(props);
    const button = screen.getByRole("button", { name: "Start work" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(events).toEqual(["saved", "io"]);
    expect(props.start).toHaveBeenCalledExactlyOnceWith(props.draft.input, expect.any(AbortSignal));
    expect(props.onDraftChange).toHaveBeenCalledWith({
      ...props.draft,
      attempt: props.draft.input,
    });
    expect(props.onStarted).not.toHaveBeenCalled();
  });

  it("confirms success once and then stops offering another start", async () => {
    const receipt = { projectId: workspaceProjectId, revision: 1 };
    const props = workspaceProps({
      start: vi.fn().mockResolvedValue({ ok: true, value: receipt }),
    });
    renderWorkspace(props);
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Start work" }));
      return Promise.resolve();
    });
    expect(props.onStarted).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(screen.getByRole("status")).toHaveTextContent("Work started.");
    expect(screen.queryByRole("button", { name: "Start work" })).not.toBeInTheDocument();
  });

  it("marks an older read as stale after a confirmed start and lets the user refresh it", async () => {
    const props = workspaceProps({
      start: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { projectId: workspaceProjectId, revision: 1 } }),
    });
    renderWorkspace(props);
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Start work" }));
      return Promise.resolve();
    });
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
    expect(screen.getByText("Refresh needed")).toBeInTheDocument();
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh project" }));
      return Promise.resolve();
    });
    expect(props.refresh).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("clears only the settled attempt against the latest controlled draft", async () => {
    const pending = deferred<ProjectStartOutcome>();
    const props = workspaceProps({ start: vi.fn(() => pending.promise) });
    const view = renderWorkspace(props);
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    const latest = workspaceProps({
      draft: {
        ...props.draft,
        input: {
          ...props.draft.input,
          intentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          expectedRevision: 2,
        },
        attempt: props.draft.input,
      },
      project: props.project === null ? null : { ...props.project, state: "on-hold", revision: 2 },
      onDraftChange: vi.fn(),
    });
    view.rerender(workspaceView(latest));
    await act(() => {
      pending.resolve({ ok: false, error: "conflict" });
      return Promise.resolve();
    });
    expect(latest.onDraftChange).toHaveBeenLastCalledWith({ ...latest.draft, attempt: null });
    expect(props.onDraftChange).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer permitted read when recovering an older successful start", async () => {
    const props = workspaceProps();
    props.draft.attempt = props.draft.input;
    props.project =
      props.project === null ? null : { ...props.project, state: "on-hold", revision: 2 };
    props.canStart = false;
    props.start = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { projectId: workspaceProjectId, revision: 1 } });
    renderWorkspace(props);
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Check start request" }));
      return Promise.resolve();
    });
    expect(screen.getByText("On hold")).toBeInTheDocument();
    expect(screen.queryByText("Refresh needed")).not.toBeInTheDocument();
  });

  it("admits a new start after a later authoritative reopen and a new draft", async () => {
    const props = workspaceProps({
      start: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { projectId: workspaceProjectId, revision: 1 } }),
    });
    const view = renderWorkspace(props);
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Start work" }));
      return Promise.resolve();
    });
    const reopened = workspaceProps({
      project: props.project === null ? null : { ...props.project, state: "planned", revision: 5 },
      draft: {
        ...props.draft,
        input: {
          ...props.draft.input,
          intentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          expectedRevision: 5,
        },
      },
    });
    view.rerender(workspaceView(reopened));
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    expect(reopened.start).toHaveBeenCalledWith(reopened.draft.input, expect.any(AbortSignal));
  });

  it("retains uncertain start identity across unmount and checks that request after a newer read", async () => {
    const pending = deferred<ProjectStartOutcome>();
    const props = workspaceProps({ start: vi.fn(() => pending.promise) });
    let retained = props.draft;
    props.onDraftChange = (draft) => {
      retained = draft;
    };
    const view = renderWorkspace(props);
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    view.unmount();
    const restored = workspaceProps({
      draft: retained,
      project: props.project === null ? null : { ...props.project, state: "active", revision: 1 },
      canStart: false,
      start: vi.fn(() => new Promise<ProjectStartOutcome>(() => undefined)),
    });
    renderWorkspace(restored);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not confirm/i);
    fireEvent.click(screen.getByRole("button", { name: "Check start request" }));
    expect(restored.start).toHaveBeenCalledWith(
      { projectId: workspaceProjectId, intentId: workspaceIntentId, expectedRevision: 0 },
      expect.any(AbortSignal),
    );
    await act(() => {
      pending.resolve({ ok: true, value: { projectId: workspaceProjectId, revision: 1 } });
      return Promise.resolve();
    });
    expect(props.onStarted).not.toHaveBeenCalled();
  });

  it("keeps a thrown transport error generic and preserves the request for retry", async () => {
    const props = workspaceProps({
      start: vi.fn().mockRejectedValue(new TypeError("SECRET provider details")),
    });
    renderWorkspace(props);
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Start work" }));
      return Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/could not confirm/i);
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check start request" })).toBeInTheDocument();
  });

  it("offers a fresh read after a confirmed conflict and preserves the last permitted snapshot", async () => {
    const props = workspaceProps({
      start: vi.fn().mockResolvedValue({ ok: false, error: "conflict" }),
    });
    renderWorkspace(props);
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Start work" }));
      return Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/changed/i);
    expect(screen.getByText("Private Studio / استودیو")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start work" })).not.toBeInTheDocument();
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh project" }));
      return Promise.resolve();
    });
    expect(props.refresh).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(props.onStarted).not.toHaveBeenCalled();
  });

  it("preserves the pending intent on a locale switch and aborts/ignores context loss", async () => {
    const pending = deferred<ProjectStartOutcome>();
    let signal: AbortSignal | undefined;
    const props = workspaceProps({
      start: vi.fn((_input, currentSignal) => {
        signal = currentSignal;
        return pending.promise;
      }),
    });
    const view = renderWorkspace(props);
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    view.rerender(workspaceView(props, "fa"));
    expect(props.start).toHaveBeenCalledTimes(1);
    view.rerender(workspaceView({ ...props, canRead: false }));
    expect(signal?.aborted).toBe(true);
    await act(() => {
      pending.resolve({ ok: true, value: { projectId: workspaceProjectId, revision: 1 } });
      return Promise.resolve();
    });
    expect(props.onStarted).not.toHaveBeenCalled();
    expect(screen.queryByText("Private Studio / استودیو")).not.toBeInTheDocument();
  });
});
