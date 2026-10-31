// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { CustomFieldDef } from "@/types/customFields";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  batchState.status = "mapping_ready";
});

const { batchState, push } = vi.hoisted(() => ({
  batchState: { status: "mapping_ready" },
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.stubGlobal(
  "fetch",
  vi.fn(() => Promise.resolve({ ok: true } as Response)),
);
// The realtime hook opens a WebSocket; stub it so the wait steps render without one.
vi.mock("@/features/import/useImportProgress", () => ({
  useImportProgress: () => ({ processed: 0, total: 0, status: null }),
}));

type Res<T> = { ok: true; value: T } | { ok: false; error: { id: string } };
type ActionFn<T> = (input: unknown, csrf: unknown) => Promise<Res<T>>;
const actions = vi.hoisted(() => ({
  requestImportUploadAction: vi.fn<
    ActionFn<{ batchId: string; post: { url: string; fields: Record<string, string> } }>
  >(() =>
    Promise.resolve({
      ok: true,
      value: { batchId: "b1", post: { url: "http://minio", fields: {} } },
    }),
  ),
  confirmImportUploadAction: vi.fn<ActionFn<{ batchId: string }>>(() =>
    Promise.resolve({ ok: true, value: { batchId: "b1" } }),
  ),
  setMappingAction: vi.fn<ActionFn<{ batchId: string }>>(() =>
    Promise.resolve({ ok: true, value: { batchId: "b1" } }),
  ),
  commitBatchAction: vi.fn<ActionFn<{ imported: number; skipped: number; invalid: number }>>(() =>
    Promise.resolve({ ok: true, value: { imported: 0, skipped: 0, invalid: 0 } }),
  ),
}));
vi.mock("@/features/import/actions", () => actions);

// The prepare wait polls getBatch; return a parsed batch so it advances to the map step.
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    import: {
      listRows: { useQuery: () => ({ data: [] }) },
      getResult: { useQuery: () => ({ data: undefined }) },
      getBatch: {
        useQuery: () => ({
          data: {
            status: batchState.status,
            headers: ["name", "grade"],
            totalRows: 1,
            validRows: 1,
            errorRows: 0,
          },
        }),
      },
    },
  },
}));

import { ImportWizard } from "./ImportWizard";

it("uploads via the presign handshake, then advances to the map step", async () => {
  render(
    <ImportWizard personDefs={[]} orgDefs={[]} dealDefs={[]} activityDefs={[]} leadDefs={[]} />,
  );
  const file = new File(["name\nJane\n"], "c.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("CSV file", { selector: "input[type=file]" }), {
    target: { files: [file] },
  });

  await waitFor(() => expect(actions.requestImportUploadAction).toHaveBeenCalledOnce());
  expect(actions.confirmImportUploadAction).toHaveBeenCalledWith("b1", "csrf");
  // prepare wait sees mapping_ready and hands the server-parsed header to the map step.
  await waitFor(() => expect(screen.getByLabelText("Maps to: name")).toBeInTheDocument());
});

it("surfaces an error banner when the upload request fails", async () => {
  actions.requestImportUploadAction.mockResolvedValueOnce({
    ok: false,
    error: { id: "E_PERM_DENIED" },
  });
  render(
    <ImportWizard personDefs={[]} orgDefs={[]} dealDefs={[]} activityDefs={[]} leadDefs={[]} />,
  );
  const file = new File(["name\nJane\n"], "c.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("CSV file", { selector: "input[type=file]" }), {
    target: { files: [file] },
  });
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
});

const gradeDef: CustomFieldDef = {
  id: "cf",
  targetEntity: "lead",
  type: "text",
  name: "Grade",
  key: "grade",
  options: [],
  isRequired: false,
  isImportant: false,
  showInAddForm: false,
  order: 0,
  archivedAt: null,
};

it("offers a lead custom field in the map step when the target is lead", async () => {
  render(
    <ImportWizard
      personDefs={[]}
      orgDefs={[]}
      dealDefs={[]}
      activityDefs={[]}
      leadDefs={[gradeDef]}
    />,
  );
  fireEvent.click(screen.getByLabelText("Leads"));
  const file = new File(["grade\nA\n"], "c.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("CSV file", { selector: "input[type=file]" }), {
    target: { files: [file] },
  });

  await waitFor(() => expect(screen.getByLabelText("Maps to: grade")).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText("Maps to: grade"));
  expect(screen.getByRole("option", { name: "Grade" })).toBeInTheDocument();
});

it("seeds the map step from label suggestions for a csv source", async () => {
  render(
    <ImportWizard personDefs={[]} orgDefs={[]} dealDefs={[]} activityDefs={[]} leadDefs={[]} />,
  );
  const file = new File(["name\nJane\n"], "c.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("CSV file", { selector: "input[type=file]" }), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Maps to: name")).toHaveTextContent("Person[Name] *"),
  );
});

it("creates a pipedrive batch and gates Continue on the Pipedrive ID", async () => {
  render(
    <ImportWizard personDefs={[]} orgDefs={[]} dealDefs={[]} activityDefs={[]} leadDefs={[]} />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Pipedrive export" }));
  const file = new File(["name\nJane\n"], "c.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("CSV file", { selector: "input[type=file]" }), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(actions.requestImportUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({ source: "pipedrive" }),
      "csrf",
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Maps to: name")).toHaveTextContent("Person[Name] *"),
  );
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
});

const emptyDefs = { personDefs: [], orgDefs: [], dealDefs: [], activityDefs: [], leadDefs: [] };

async function preview() {
  const view = render(<ImportWizard {...emptyDefs} />);
  fireEvent.change(screen.getByLabelText("CSV file", { selector: "input[type=file]" }), {
    target: { files: [new File(["name\nJane\n"], "c.csv", { type: "text/csv" })] },
  });
  await screen.findByLabelText("Maps to: name");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(actions.setMappingAction).toHaveBeenCalledOnce());
  batchState.status = "ready";
  view.rerender(<ImportWizard {...emptyDefs} />);
  await screen.findByRole("button", { name: "Import 1 valid rows" });
  return view;
}

it("reviews validated mapping read-only and keeps the current preview intact", async () => {
  await preview();
  fireEvent.click(screen.getByRole("button", { name: "Review mapping" }));
  const dialog = screen.getByRole("dialog", { name: "Review mapping" });
  expect(dialog).toHaveTextContent("This mapping has already been validated");
  expect(dialog).toHaveTextContent("Person[Name] *");
  expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.getByRole("button", { name: "Import 1 valid rows" })).toBeInTheDocument();
  expect(actions.setMappingAction).toHaveBeenCalledOnce();
  expect(actions.commitBatchAction).not.toHaveBeenCalled();
});

it("starts a fresh upload when changing a validated mapping, without mutating the old batch", async () => {
  await preview();
  fireEvent.click(screen.getByRole("button", { name: "Review mapping" }));
  fireEvent.click(screen.getByRole("button", { name: "Import another file" }));
  expect(screen.getByLabelText("CSV file", { selector: "input[type=file]" })).toBeInTheDocument();
  expect(actions.commitBatchAction).not.toHaveBeenCalled();
  expect(actions.setMappingAction).toHaveBeenCalledOnce();
});

it("explains leaving setup without claiming to cancel its background job", async () => {
  await preview();
  fireEvent.click(screen.getByRole("button", { name: "Leave import" }));
  const dialog = screen.getByRole("alertdialog", { name: "Leave this import?" });
  expect(dialog).toHaveTextContent("The uploaded batch stays in import history");
  expect(dialog).toHaveTextContent("Preparation or validation already running may finish");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Import 1 valid rows" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Leave import" }));
  fireEvent.click(screen.getByRole("button", { name: "Leave setup" }));
  expect(push).toHaveBeenCalledWith("/settings/import");
  expect(actions.commitBatchAction).not.toHaveBeenCalled();
});

it("locks review and leave while a commit request is pending and prevents duplicate commits", async () => {
  let finish: (value: Res<{ imported: number; skipped: number; invalid: number }>) => void =
    () => {};
  actions.commitBatchAction.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await preview();
  const commit = screen.getByRole("button", { name: "Import 1 valid rows" });
  fireEvent.click(commit);
  fireEvent.click(commit);
  expect(actions.commitBatchAction).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Review mapping" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Leave import" })).toBeDisabled();
  finish({ ok: true, value: { imported: 0, skipped: 0, invalid: 0 } });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Review mapping" })).not.toBeInTheDocument(),
  );
});
