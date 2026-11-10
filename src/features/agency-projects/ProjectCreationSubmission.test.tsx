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
  projectId,
  renderCreation,
} from "./ProjectCreationForm.test-support";

afterEach(cleanup);

function submitForm() {
  fireEvent.submit(screen.getByRole("form"));
}

describe("project creation submission", () => {
  it("admits only one synchronous submission and locks fields until a confirmed response", () => {
    const props = creationProps();
    renderCreation(props);
    submitForm();
    submitForm();
    expect(props.submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(props.onCreated).not.toHaveBeenCalled();
  });

  it.each(["rejected", "unavailable"] as const)(
    "retains the draft after a confirmed %s response and reuses its intent",
    async (error) => {
      const props = creationProps({ submit: vi.fn().mockResolvedValue({ ok: false, error }) });
      renderCreation(props);
      await act(() => {
        submitForm();
        return Promise.resolve();
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toHaveValue(props.draft.input.title);
      expect(screen.getByRole("textbox")).not.toBeDisabled();
      await act(() => {
        submitForm();
        return Promise.resolve();
      });
      expect(props.submit).toHaveBeenCalledTimes(2);
      expect(props.submit).toHaveBeenLastCalledWith(
        expect.objectContaining({ intentId: props.draft.input.intentId }),
        expect.any(AbortSignal),
      );
      expect(props.onCreated).not.toHaveBeenCalled();
    },
  );

  it.each(["returned", "thrown"] as const)(
    "keeps an uncertain %s outcome honest and retries the captured payload",
    async (mode) => {
      const pending = deferred<ProjectCreationOutcome>();
      const props = creationProps({ submit: vi.fn(() => pending.promise) });
      const view = renderCreation(props);
      submitForm();
      const submitted = { ...props.draft.input, title: props.draft.input.title.trim() };
      await act(() => {
        if (mode === "returned") pending.resolve({ ok: false, error: "unknown" });
        else pending.reject(new TypeError("SECRET request/title/staff/provider details"));
        return Promise.resolve();
      });
      expect(screen.getByRole("alert")).toHaveTextContent(/could not confirm/i);
      expect(screen.getByRole("alert")).toHaveTextContent(/this form/i);
      expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeDisabled();
      expect(props.onCreated).not.toHaveBeenCalled();
      const changed = {
        ...props,
        draft: {
          ...props.draft,
          input: { ...props.draft.input, title: "External replacement", intentId: projectId },
        },
        submit: vi.fn(() => new Promise<ProjectCreationOutcome>(() => undefined)),
      };
      view.rerender(creationView(changed, "de"));
      expect(screen.getByRole("textbox")).toHaveValue(props.draft.input.title);
      fireEvent.click(screen.getByRole("button"));
      expect(changed.submit).toHaveBeenCalledWith(submitted, expect.any(AbortSignal));
      expect(changed.onCreated).not.toHaveBeenCalled();
    },
  );

  it("publishes confirmed success once and prevents another create", async () => {
    const props = creationProps({
      submit: vi.fn().mockResolvedValue({ ok: true, value: { projectId } }),
    });
    renderCreation(props);
    await act(() => {
      submitForm();
      return Promise.resolve();
    });
    expect(props.onCreated).toHaveBeenCalledExactlyOnceWith(projectId);
    submitForm();
    expect(props.submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("finishes an uncertain retry with the original payload exactly once", async () => {
    const pending = deferred<ProjectCreationOutcome>();
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unknown" })
      .mockImplementationOnce(() => pending.promise);
    const props = creationProps({ submit });
    renderCreation(props);
    await act(() => {
      submitForm();
      return Promise.resolve();
    });
    submitForm();
    expect(submit).toHaveBeenNthCalledWith(
      2,
      { ...props.draft.input, title: props.draft.input.title.trim() },
      expect.any(AbortSignal),
    );
    await act(() => {
      pending.resolve({ ok: true, value: { projectId } });
      return Promise.resolve();
    });
    expect(props.onCreated).toHaveBeenCalledExactlyOnceWith(projectId);
    submitForm();
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ok: true, value: { projectId } },
    { ok: false, error: "unknown" },
    { ok: false, error: "rejected" },
  ] satisfies ProjectCreationOutcome[])(
    "ignores an old outcome after the same context is restored: %j",
    async (outcome) => {
      const pending = deferred<ProjectCreationOutcome>();
      const props = creationProps({ submit: vi.fn(() => pending.promise) });
      const view = renderCreation(props);
      submitForm();
      view.rerender(creationView({ ...props, contextKey: "different-context" }));
      view.rerender(creationView(props));
      await act(() => {
        pending.resolve(outcome);
        return Promise.resolve();
      });
      expect(props.onCreated).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox")).not.toBeDisabled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it.each(["context", "permission", "unmount"] as const)(
    "aborts and ignores late success after %s disappears",
    async (change) => {
      const pending = deferred<ProjectCreationOutcome>();
      let observedSignal: AbortSignal | undefined;
      const props = creationProps({
        submit: vi.fn((_input, signal) => {
          observedSignal = signal;
          return pending.promise;
        }),
      });
      const view = renderCreation(props);
      submitForm();
      if (change === "unmount") view.unmount();
      else
        view.rerender(
          creationView({
            ...props,
            ...(change === "context" ? { contextKey: "other-context" } : { canCreate: false }),
          }),
        );
      expect(observedSignal?.aborted).toBe(true);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      await act(() => {
        pending.resolve({ ok: true, value: { projectId } });
        return Promise.resolve();
      });
      expect(props.onCreated).not.toHaveBeenCalled();
    },
  );
});
