// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { QualityCommandResult, QualityTargetDetail } from "../contracts";
import type { ExecuteInspectionCommand } from "./InspectionForm";
import { InspectionForm } from "./InspectionForm";
import { InspectionTarget } from "./InspectionTarget";
import { inspectionMessages } from "./inspectionMessages";

const execute = vi.fn<ExecuteInspectionCommand>();
const target: QualityTargetDetail = {
  id: "target",
  siteId: "site",
  positionId: "position",
  buildId: "build",
  outputId: "output",
  releaseId: "release",
  releaseRevision: "A",
  partCode: "QA-CTRL",
  partName: "Controller",
  serial: "CTRL-001",
  lot: "LOT-1",
  status: "pending",
  createdAt: "2026-11-21T19:00:00Z",
  canRecord: true,
  runs: [],
  plan: {
    id: "plan",
    name: "Controller torque",
    version: 1,
    steps: [
      {
        key: "torque",
        label: "Drehmoment",
        kind: "measurement",
        unit: "Nm",
        minimum: 1.2,
        maximum: 1.8,
        evidenceRequired: true,
      },
    ],
  },
};

const t = inspectionMessages.de;

beforeEach(() => execute.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function form() {
  const saved = vi.fn(async () => {});
  render(
    <LocaleProvider locale="de" country="DE">
      <InspectionForm
        target={target}
        t={t}
        busy={false}
        saved={saved}
        execute={execute}
        refresh={vi.fn()}
      />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: t.station }), {
    target: { value: "Bench 1" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: `${t.actual} (Nm)` }), {
    target: { value: "1,5" },
  });
  const submit = () => fireEvent.submit(screen.getByRole("form", { name: t.recordRun }));
  return { saved, submit };
}

test("requires evidence before sending a measurement", () => {
  const { submit } = form();
  submit();
  expect(screen.getByRole("alert")).toHaveTextContent(t.evidenceNeeded);
  expect(execute).not.toHaveBeenCalled();
});

test("reuses sealed evidence and the original request ID if the result save is interrupted", async () => {
  const savedResult: QualityCommandResult = { ok: true, value: { runId: "run", passed: true } };
  const transfer = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", transfer);
  execute
    .mockResolvedValueOnce({
      ok: true,
      value: {
        evidenceId: "file-id",
        post: { url: "http://127.0.0.1:8001", fields: { key: "test" } },
      },
    })
    .mockResolvedValueOnce({ ok: true, value: { evidenceId: "file-id" } })
    .mockRejectedValueOnce(new Error("save interrupted"))
    .mockResolvedValueOnce(savedResult);
  const { submit, saved } = form();
  const file = new File(["torque=1.5"], "torque.txt", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText(t.requiredEvidence), { target: { files: [file] } });

  submit();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(t.transport));
  submit();
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());

  expect(transfer).toHaveBeenCalledOnce();
  expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
    "requestEvidence",
    "confirmEvidence",
    "recordRun",
    "recordRun",
  ]);
  const recorded = execute.mock.calls[2]?.[0];
  expect(recorded).toMatchObject({
    station: "Bench 1",
    results: [{ key: "torque", actual: 1.5, evidenceIds: ["file-id"] }],
  });
  expect(execute.mock.calls[3]?.[0]).toEqual(recorded);
});

test("shows the failed run and its exact evidence link after a successful retest", () => {
  const passed: QualityTargetDetail = {
    ...target,
    status: "passed",
    canRecord: false,
    runs: [
      {
        id: "retest",
        station: "Bench 2",
        actorName: "Inspector",
        createdAt: "2026-11-21T20:00:00Z",
        passed: true,
        results: [{ key: "torque", actual: 1.4, passed: true, evidence: [] }],
      },
      {
        id: "initial-run",
        station: "Bench 1",
        actorName: "Inspector",
        createdAt: "2026-11-21T19:30:00Z",
        passed: false,
        results: [
          {
            key: "torque",
            actual: 1.1,
            passed: false,
            evidence: [{ id: "initial-evidence", name: "torque.csv", sizeBytes: 32 }],
          },
        ],
      },
    ],
  };
  render(
    <InspectionTarget
      target={passed}
      siteName="Factory"
      t={t}
      busy={false}
      saved={() => Promise.resolve()}
      execute={execute}
      refresh={vi.fn()}
    />,
  );
  expect(screen.getByText(t.released)).toBeVisible();
  expect(screen.getByText("Bench 1")).toBeVisible();
  expect(screen.getByText("Bench 2")).toBeVisible();
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "torque.csv" })).toHaveAttribute(
    "href",
    "/inventory/quality/evidence?targetId=target&runId=initial-run&evidenceId=initial-evidence",
  );
});
