// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SelectOption } from "@/components/ui/Select";
import type {
  ChangeReview,
  EngineeringChange,
  EngineeringChangeAccess,
  EngineeringChangeResult,
  EngineeringChangeWorkspace,
} from "../contracts";
import { EngineeringChangePanel } from "./EngineeringChangePanel";

vi.mock("@/components/ui/Select", () => ({
  Select: ({
    value,
    onChange,
    ariaLabel,
    options,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    options: SelectOption[];
    disabled: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Select</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const base = { id: "release-a", revision: "A", status: "released" } as const;
const candidate = { id: "release-b", revision: "B", status: "draft" } as const;
const later = { id: "release-c", revision: "C", status: "draft" } as const;
const review: ChangeReview = {
  base,
  candidate,
  fingerprint: "exact-review-sha",
  ready: true,
  design: [
    {
      key: "pcb",
      kind: "pcbSource",
      before: null,
      after: { name: "board-b.kicad_pcb", sha256: "file-sha" },
    },
  ],
  materials: [
    {
      key: "material",
      sku: "PCB-24",
      before: null,
      after: {
        quantity: "2",
        unit: "ea",
        childRelease: null,
        alternatives: ["PCB-ALT"],
        optional: false,
        consumable: false,
        inherited: false,
        pieces: null,
      },
    },
  ],
  whereUsed: [{ key: "related", parentSku: "PARENT-24", revision: "A", componentSku: "PCB-24" }],
};
const workspace: EngineeringChangeWorkspace = {
  itemId: "item-a",
  sku: "PRODUCT-24",
  effectiveRelease: base,
  candidates: [candidate, later],
  canPropose: true,
  canDecide: true,
  changes: [],
  stock: null,
};
const effectiveAt = "2050-06-05T10:45:15.000Z";
const record: EngineeringChange = {
  id: "change-b",
  version: 4,
  status: "review",
  review,
  effectiveAt,
  reason: "Add the alternate PCB",
  history: [
    {
      id: "submit-1",
      type: "submitted",
      at: "2026-01-02T12:00:00Z",
      actor: "Release editor",
      note: null,
    },
  ],
};

function allow<T>(value: T): EngineeringChangeResult<T> {
  return { ok: true, value };
}
function setup(testWorkspace = workspace) {
  const read = vi.fn<EngineeringChangeAccess["read"]>().mockResolvedValue(allow(testWorkspace));
  const preview = vi.fn<EngineeringChangeAccess["preview"]>().mockResolvedValue(allow(review));
  const execute = vi
    .fn<EngineeringChangeAccess["execute"]>()
    .mockResolvedValue(allow(testWorkspace));
  return { access: { read, preview, execute }, read, preview, execute };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((keep) => {
    resolve = keep;
  });
  return { promise, resolve };
}
async function choose(id: string = candidate.id) {
  fireEvent.change(await screen.findByRole("combobox", { name: "Draft release" }), {
    target: { value: id },
  });
}

afterEach(cleanup);

it("shows exact before and after values when material flags and piece counts are the only changes", async () => {
  const { access, preview } = setup();
  const sameMaterial = { quantity: "2", unit: "ea", childRelease: null, alternatives: [] };
  preview.mockResolvedValue(
    allow({
      ...review,
      materials: [
        {
          key: "material-flags",
          sku: "PCB-24",
          before: {
            ...sameMaterial,
            optional: true,
            consumable: false,
            inherited: false,
            pieces: null,
          },
          after: { ...sameMaterial, optional: false, consumable: true, inherited: true, pieces: 4 },
        },
      ],
    }),
  );
  render(<EngineeringChangePanel itemId={workspace.itemId} access={access} />);
  await choose();
  const materials = await screen.findByRole("region", { name: "Manufacturing BOM" });
  const row = within(materials).getByText("PCB-24");
  const values = row.parentElement?.querySelectorAll("dd");
  expect(values).toHaveLength(2);
  const before = values?.[0];
  const after = values?.[1];
  expect(before).toHaveTextContent("Optional Yes");
  expect(before).toHaveTextContent("Consumable No");
  expect(before).toHaveTextContent("Inherited No");
  expect(before?.querySelector("[data-engineering-material-pieces]")).toHaveTextContent("—");
  expect(after).toHaveTextContent("Optional No");
  expect(after).toHaveTextContent("Consumable Yes");
  expect(after).toHaveTextContent("Inherited Yes");
  expect(after?.querySelector("[data-engineering-material-pieces]")).toHaveTextContent("4");
});

it("submits the reviewed candidate, binds UTC and reuses the exact request after an uncertain response", async () => {
  const { access, execute, read } = setup();
  execute.mockRejectedValueOnce(new Error("connection lost"));
  render(<EngineeringChangePanel itemId={workspace.itemId} access={access} />);
  await choose();
  expect(await screen.findByText("board-b.kicad_pcb")).toBeVisible();
  expect(screen.getByText("PCB-ALT")).toBeVisible();
  expect(screen.getByText("PARENT-24 · A")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Effective date and time (UTC)"), {
    target: { value: "2050-06-05T10:45:15" },
  });
  fireEvent.change(screen.getByLabelText("Reason for change"), {
    target: { value: "  Add the alternate PCB  " },
  });
  const submit = screen.getByRole("button", { name: "Submit for review" });
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
  read.mockResolvedValue(allow({ ...workspace, changes: [record] }));
  fireEvent.click(submit);
  expect(await screen.findByText("Change submitted for review.")).toBeVisible();
  expect(execute).toHaveBeenCalledTimes(2);
  const first = execute.mock.calls[0]?.[0];
  expect(first).toMatchObject({
    itemId: workspace.itemId,
    type: "submit",
    baseReleaseId: base.id,
    candidateReleaseId: candidate.id,
    fingerprint: review.fingerprint,
    effectiveAt,
    reason: "Add the alternate PCB",
    requestId: expect.any(String),
  });
  expect(execute.mock.calls[1]?.[0]).toEqual(first);
  expect(await screen.findByText("Release editor")).toBeVisible();
});

it("immediately masks the old workspace after a focus recheck and ignores a late preview", async () => {
  const { access, preview, read } = setup({ ...workspace, changes: [record] });
  const pending = deferred<EngineeringChangeResult<ChangeReview>>();
  const recheck = deferred<EngineeringChangeResult<EngineeringChangeWorkspace>>();
  preview.mockReturnValueOnce(pending.promise);
  const { container } = render(
    <EngineeringChangePanel itemId={workspace.itemId} access={access} />,
  );
  await choose(later.id);
  expect(await screen.findByText("Comparing release packages…")).toBeVisible();
  expect(screen.getByText("Release editor")).toBeVisible();
  read.mockReturnValueOnce(recheck.promise);
  fireEvent(window, new Event("focus"));
  expect(container.querySelector("[data-engineering-change]")).toBeNull();
  expect(container.querySelector("[data-engineering-preview]")).toBeNull();
  expect(preview.mock.calls[0]?.[2]?.aborted).toBe(true);
  await act(async () => {
    pending.resolve(allow({ ...review, candidate: later }));
    recheck.resolve({ ok: false, error: "unavailable" });
    await recheck.promise;
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("unavailable for this product");
  expect(screen.queryByText("board-b.kicad_pcb")).not.toBeInTheDocument();
  expect(screen.queryByText("Release editor")).not.toBeInTheDocument();
});

it("sends an exact return decision and shows traced stock, action history and permissions", async () => {
  const stock = {
    positions: [
      {
        id: "position-1",
        changeId: record.id,
        version: "version-2",
        revision: "A",
        site: "Berlin",
        location: "A-2",
        lot: "LOT-01",
        serial: "SERIAL-9",
        quantity: "1",
        reserved: "0",
        status: "held" as const,
        canDispose: true,
        history: [
          {
            id: "hold-1",
            action: "hold" as const,
            at: "2026-01-02T12:00:00Z",
            actor: "Warehouse actor",
            reason: "Check the label",
          },
        ],
      },
    ],
    unattributed: true,
  };
  const { access, execute, read } = setup({ ...workspace, changes: [record], stock });
  const { rerender } = render(<EngineeringChangePanel itemId={workspace.itemId} access={access} />);
  const history = await screen.findByRole("region", { name: "Stock disposition history" });
  expect(within(history).getByText("Check the label")).toBeVisible();
  expect(screen.getByText("LOT-01")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Reason for return"), {
    target: { value: "Verify test data" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Return for revision" }));
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "return",
        changeId: record.id,
        expectedVersion: 4,
        note: "Verify test data",
      }),
    ),
  );
  await screen.findByText("Change returned for revision.");
  fireEvent.change(await screen.findByLabelText("Reason for stock action"), {
    target: { value: "Label verified" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Release stock" }));
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "disposition",
        changeId: record.id,
        positionId: "position-1",
        expectedPositionVersion: "version-2",
        action: "release",
        reason: "Label verified",
      }),
    ),
  );
  await screen.findByText("Stock disposition recorded.");
  read.mockResolvedValue(
    allow({ ...workspace, canPropose: false, canDecide: false, changes: [record], stock: null }),
  );
  rerender(<EngineeringChangePanel itemId={workspace.itemId} access={{ ...access }} />);
  expect(await screen.findByText("Release editor")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Approve change" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Release stock" })).not.toBeInTheDocument();
  expect(screen.queryByText("LOT-01")).not.toBeInTheDocument();
});
