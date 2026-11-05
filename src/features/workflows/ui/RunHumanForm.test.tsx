// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { submitWorkflowHumanFormAction } from "../actions";
import { RunHumanForm } from "./RunHumanForm";

vi.mock("../actions", () => ({ submitWorkflowHumanFormAction: vi.fn() }));
afterEach(cleanup);

it("retries an unconfirmed response with the original answers and receipt key", async () => {
  const submit = vi.mocked(submitWorkflowHumanFormAction);
  submit.mockReset();
  submit
    .mockRejectedValueOnce(new Error("internal transport text"))
    .mockResolvedValueOnce({ ok: true, value: { id: "run" } });
  const onSubmitted = vi.fn();
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="en">
      <RunHumanForm
        form={{
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
        }}
        workflowId="workflow"
        runId="run"
        onSubmitted={onSubmitted}
      />
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
});
