// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectCreationOutcome } from "./ProjectCreationForm";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

import {
  creationProps,
  creationView,
  deferred,
  otherOwnerId,
  projectId,
  renderCreation,
} from "./ProjectCreationForm.test-support";

afterEach(cleanup);

describe("project creation recovery across teardown", () => {
  it.each([
    { ok: true, value: { projectId } },
    { ok: false, error: "rejected" },
    { ok: false, error: "unavailable" },
  ] satisfies ProjectCreationOutcome[])(
    "saves the attempt before I/O and clears it only after a confirmed outcome: %j",
    async (outcome) => {
      const pending = deferred<ProjectCreationOutcome>();
      const events: string[] = [];
      const props = creationProps({
        submit: vi.fn(() => {
          events.push("io");
          return pending.promise;
        }),
      });
      let retainedDraft = props.draft;
      props.onDraftChange = (draft) => {
        retainedDraft = draft;
        events.push(draft.attempt === null ? "clear" : "save");
      };
      renderCreation(props);
      fireEvent.submit(screen.getByRole("form"));
      expect(events).toEqual(["save", "io"]);
      expect(retainedDraft.attempt?.payload).toEqual({
        ...props.draft.input,
        title: props.draft.input.title.trim(),
      });
      await act(() => {
        pending.resolve(outcome);
        return Promise.resolve();
      });
      expect(events).toEqual(["save", "io", "clear"]);
      expect(retainedDraft.attempt).toBeNull();
    },
  );

  it.each(["pending", "unknown"] as const)(
    "retains the captured %s attempt in the parent draft across remount",
    async (phase) => {
      const initial = deferred<ProjectCreationOutcome>();
      const retry = deferred<ProjectCreationOutcome>();
      const props = creationProps({ submit: vi.fn(() => initial.promise) });
      let retainedDraft = props.draft;
      props.onDraftChange = (draft) => {
        retainedDraft = draft;
      };
      const view = renderCreation(props);
      fireEvent.submit(screen.getByRole("form"));
      if (phase === "unknown")
        await act(() => {
          initial.resolve({ ok: false, error: "unknown" });
          return Promise.resolve();
        });
      view.unmount();
      const restored = {
        ...props,
        draft: {
          ...retainedDraft,
          input: {
            ...retainedDraft.input,
            title: "Changed outside the closed form",
            intentId: projectId,
          },
        },
        submit: vi.fn(() => retry.promise),
      };
      renderCreation(restored);
      expect(screen.getByRole("textbox")).toHaveValue(props.draft.input.title);
      expect(screen.getByRole("textbox")).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/could not confirm/i);
      if (phase === "pending")
        await act(() => {
          initial.resolve({ ok: true, value: { projectId } });
          return Promise.resolve();
        });
      expect(props.onCreated).not.toHaveBeenCalled();
      fireEvent.submit(screen.getByRole("form"));
      expect(restored.submit).toHaveBeenCalledWith(
        { ...props.draft.input, title: props.draft.input.title.trim() },
        expect.any(AbortSignal),
      );
      await act(() => {
        retry.resolve({ ok: true, value: { projectId } });
        return Promise.resolve();
      });
      expect(props.onCreated).toHaveBeenCalledExactlyOnceWith(projectId);
    },
  );

  it("explains and disables recovery while the captured owner is unavailable, then retries after restoration", async () => {
    const pending = deferred<ProjectCreationOutcome>();
    const props = creationProps({
      submit: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: "unknown" })
        .mockImplementationOnce(() => pending.promise),
    });
    const view = renderCreation(props);
    await act(() => {
      fireEvent.submit(screen.getByRole("form"));
      return Promise.resolve();
    });
    view.rerender(creationView({ ...props, owners: [{ id: otherOwnerId, label: "Alex Müller" }] }));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not confirm/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/retry.*unavailable/i);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
    fireEvent.submit(screen.getByRole("form"));
    expect(props.submit).toHaveBeenCalledTimes(1);
    view.rerender(creationView(props));
    expect(screen.getByRole("button")).not.toBeDisabled();
    fireEvent.submit(screen.getByRole("form"));
    expect(props.submit).toHaveBeenLastCalledWith(
      { ...props.draft.input, title: props.draft.input.title.trim() },
      expect.any(AbortSignal),
    );
    await act(() => {
      pending.resolve({ ok: false, error: "unavailable" });
      return Promise.resolve();
    });
  });
});
