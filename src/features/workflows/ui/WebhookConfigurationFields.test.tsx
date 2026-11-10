// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { WebhookConfigurationFields } from "./WebhookConfigurationFields";

const reads = vi.hoisted(() => ({ workflow: vi.fn(), version: vi.fn() }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: { workflows: { get: { useQuery: reads.workflow }, version: { useQuery: reads.version } } },
}));

const workflowId = "071298e7-d2f4-4aeb-bdc7-c95c4dd433a8";
const versionId = "e04e8f03-7867-49d8-aa7d-241e9277bcf0";
const route = `/api/workflows/${workflowId}/webhook/${versionId}`;
const node: WorkflowNode = {
  id: "start",
  type: "trigger.webhook",
  version: 1,
  name: "Webhook",
  config: { httpMethod: "POST", authentication: "HMAC_SHA256" },
};
const active = { id: workflowId, active: true, archivedAt: null, publishedNumber: 2 };
const publication = {
  id: versionId,
  number: 2,
  definition: { schemaVersion: 1, nodes: [node], edges: [] },
};

function fresh(data: unknown) {
  return {
    data,
    isSuccess: true,
    isFetchedAfterMount: true,
    isPlaceholderData: false,
    fetchStatus: "idle",
  };
}

function panel(
  props: {
    id?: string;
    node?: WorkflowNode;
    editable?: boolean;
    onChange?: (value: WorkflowNode) => void;
  } = {},
) {
  return (
    <LocaleProvider locale="en">
      <WebhookConfigurationFields
        node={props.node ?? node}
        workflowId={props.id}
        editable={props.editable ?? true}
        onChange={props.onChange ?? vi.fn()}
        validation={{ status: "valid", issues: [], runtimeChecks: [] }}
      />
    </LocaleProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  reads.workflow.mockReturnValue(fresh(active));
  reads.version.mockReturnValue(fresh(publication));
});
afterEach(cleanup);

it("authors only GET or POST with the fixed signing mode and no publication read for a new workflow", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(value: WorkflowNode) => void>();
  render(panel({ onChange }));
  await user.click(screen.getByRole("combobox", { name: "HTTP method" }));
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "GET",
    "POST",
  ]);
  await user.click(screen.getByRole("option", { name: "GET" }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    ...node,
    config: { httpMethod: "GET", authentication: "HMAC_SHA256" },
  });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText(/Publish and activate/)).toBeVisible();
  expect(reads.workflow).not.toHaveBeenCalled();
  expect(reads.version).not.toHaveBeenCalled();
});

it("shows the exact authorized publication endpoint and hides it when the workflow is paused", () => {
  const { rerender } = render(panel({ id: workflowId, editable: false }));
  expect(screen.getByRole("combobox", { name: "HTTP method" })).toBeDisabled();
  expect(screen.getByText(route)).toBeVisible();
  expect(reads.version).toHaveBeenLastCalledWith(
    { id: workflowId, versionNumber: 2 },
    expect.objectContaining({ enabled: true }),
  );
  reads.workflow.mockReturnValue(fresh({ ...active, active: false }));
  rerender(panel({ id: workflowId, editable: false }));
  expect(screen.queryByText(route)).toBeNull();
  expect(screen.getByText(/Publish and activate/)).toBeVisible();
  expect(reads.version).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ enabled: false }),
  );
});

it("hides stale, wrong-version and mismatched draft endpoints", () => {
  reads.version.mockReturnValue({ ...fresh(publication), isFetchedAfterMount: false });
  const { rerender } = render(panel({ id: workflowId }));
  expect(screen.queryByText(route)).toBeNull();
  reads.version.mockReturnValue(fresh({ ...publication, number: 1 }));
  rerender(panel({ id: workflowId }));
  expect(screen.queryByText(route)).toBeNull();
  reads.version.mockReturnValue(fresh(publication));
  rerender(
    panel({ id: workflowId, node: { ...node, config: { ...node.config, httpMethod: "GET" } } }),
  );
  expect(screen.queryByText(route)).toBeNull();
  rerender(panel({ id: workflowId }));
  expect(screen.getByText(route)).toBeVisible();
});
