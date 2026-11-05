// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { submitWorkflowHumanFormAction } from "../actions";
import type { PendingWorkflowHumanForm } from "../workflowHumanFormPending";
import { RunDetailDialog } from "./RunDetailDialog";
import { RunHumanForm } from "./RunHumanForm";

const io = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../actions", () => ({ submitWorkflowHumanFormAction: vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({ trpc: { workflows: { run: { useQuery: io.read } } } }));
vi.mock("./RunTrace", () => ({ RunTrace: () => null }));
afterEach(cleanup);

const form: PendingWorkflowHumanForm = {
  nodeId: "collect",
  deadline: new Date("2026-11-12T00:00:00Z"),
  fields: [
    {
      id: "1b317568-2522-42b6-a3cf-e83b3ee452f8",
      label: "Company name",
      type: "text",
      required: true,
    },
  ],
};
const submit = vi.mocked(submitWorkflowHumanFormAction);

it.each(["transport error", "write failure"] as const)(
  "retries an unconfirmed %s with the original answers and receipt key",
  async (failure) => {
    submit.mockReset();
    if (failure === "transport error")
      submit.mockRejectedValueOnce(new Error("internal transport text"));
    else submit.mockResolvedValueOnce({ ok: false, error: ERROR_IDS.WORKFLOW_WRITE_FAILED });
    submit.mockResolvedValueOnce({ ok: true, value: { id: "run" } });
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(
      <LocaleProvider locale="en">
        <RunHumanForm form={form} workflowId="workflow" runId="run" onSubmitted={onSubmitted} />
      </LocaleProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Company name" });
    await user.type(input, "Synthetic company");
    await user.click(screen.getByRole("button", { name: "Submit response" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not confirm/i);
    expect(alert.textContent).not.toMatch(/internal transport text/i);
    expect(input.matches(":disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByRole("status")).textContent).toBe("Response submitted");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0]).toEqual(submit.mock.calls[0]?.[0]);
    expect(onSubmitted).toHaveBeenCalledOnce();
  },
);

function dialog() {
  return (
    <LocaleProvider locale="en">
      <RunDetailDialog workflowId="workflow" runId="run" onClose={() => undefined} />
    </LocaleProvider>
  );
}

const healthyRead = {
  data: { id: "run", pendingForm: form, status: "waiting" },
  isError: false,
  isRefetchError: false,
  refetch: vi.fn().mockResolvedValue(undefined),
};

function failedRead(code: string) {
  return {
    ...healthyRead,
    isError: true,
    isRefetchError: true,
    error: { data: { code } },
  };
}

it("locks an unconfirmed form during a failed poll and retains the exact retry after recovery", async () => {
  io.read.mockReturnValue(healthyRead);
  submit.mockReset();
  submit
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce({ ok: true, value: { id: "run" } });
  const user = userEvent.setup();
  const view = render(dialog());
  const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Company name" });
  await user.type(input, "Synthetic company");
  await user.click(screen.getByRole("button", { name: "Submit response" }));
  await screen.findByRole("button", { name: "Try again" });

  io.read.mockReturnValue(failedRead("INTERNAL_SERVER_ERROR"));
  view.rerender(dialog());
  expect(input.isConnected).toBe(true);
  expect(input.matches(":disabled")).toBe(true);
  expect(screen.queryByRole("textbox", { name: "Company name" })).toBeNull();
  expect(submit).toHaveBeenCalledOnce();

  io.read.mockReturnValue(healthyRead);
  view.rerender(dialog());
  expect(screen.getByRole("textbox", { name: "Company name" })).toBe(input);
  expect(input.value).toBe("Synthetic company");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Response submitted");
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[1]?.[0]).toEqual(submit.mock.calls[0]?.[0]);
});

it.each(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"] as const)(
  "discards local answers after a confirmed %s read",
  async (code) => {
    io.read.mockReturnValue(healthyRead);
    const user = userEvent.setup();
    const view = render(dialog());
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Company name" });
    await user.type(input, "Discarded synthetic company");
    io.read.mockReturnValue(failedRead(code));
    view.rerender(dialog());
    expect(input.isConnected).toBe(false);

    io.read.mockReturnValue(healthyRead);
    view.rerender(dialog());
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Company name" }).value).toBe("");
  },
);
