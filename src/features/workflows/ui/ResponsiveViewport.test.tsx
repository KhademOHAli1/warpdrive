// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResponsiveViewport } from "./ResponsiveViewport";

const flow = vi.hoisted(() => ({ width: 900, fitView: vi.fn().mockResolvedValue(true) }));
vi.mock("@xyflow/react", () => ({
  useStore: (selector: (state: { width: number }) => number) => selector({ width: flow.width }),
  useNodesInitialized: () => true,
  useReactFlow: () => ({ fitView: flow.fitView }),
}));
afterEach(() => {
  cleanup();
  flow.width = 900;
  flow.fitView.mockClear();
});
it("fits nodes again after a substantial canvas width change", () => {
  const view = render(<ResponsiveViewport />);
  expect(flow.fitView).not.toHaveBeenCalled();
  flow.width = 340;
  view.rerender(<ResponsiveViewport />);
  expect(flow.fitView).toHaveBeenCalledTimes(1);
});
it("preserves the camera across ordinary rerenders and small width changes", () => {
  const view = render(<ResponsiveViewport />);
  flow.width = 898;
  view.rerender(<ResponsiveViewport />);
  expect(flow.fitView).not.toHaveBeenCalled();
});
it("reveals an offscreen step at a readable scale only for an explicit navigation request", () => {
  const view = render(<ResponsiveViewport reveal={{ id: "task", nonce: 1 }} />);
  expect(flow.fitView).toHaveBeenLastCalledWith({
    nodes: [{ id: "task" }],
    padding: 0.6,
    minZoom: 0.8,
    maxZoom: 1,
    duration: 180,
  });
  flow.fitView.mockClear();
  view.rerender(<ResponsiveViewport reveal={{ id: "task", nonce: 1 }} />);
  expect(flow.fitView).not.toHaveBeenCalled();
});
