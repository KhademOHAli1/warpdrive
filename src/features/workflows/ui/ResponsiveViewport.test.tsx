// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResponsiveViewport } from "./ResponsiveViewport";

const flow = vi.hoisted(() => ({
  width: 900,
  fitView: vi.fn().mockResolvedValue(true),
  setViewport: vi.fn().mockResolvedValue(true),
  nodes: [{ id: "start" }],
  bounds: { x: 40, y: 0, width: 240, height: 350 },
  viewport: { x: 0, y: 150, zoom: 1 },
}));
vi.mock("@xyflow/react", () => ({
  useStore: (selector: (state: { width: number }) => number) => selector({ width: flow.width }),
  useNodesInitialized: () => true,
  useReactFlow: () => ({
    fitView: flow.fitView,
    setViewport: flow.setViewport,
    getNodes: () => flow.nodes,
    getNodesBounds: () => flow.bounds,
    getViewport: () => flow.viewport,
  }),
}));
afterEach(() => {
  cleanup();
  flow.width = 900;
  flow.fitView.mockClear();
  flow.setViewport.mockClear();
  flow.nodes = [{ id: "start" }];
  flow.viewport = { x: 0, y: 150, zoom: 1 };
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
  expect(flow.setViewport).toHaveBeenCalledTimes(1);
});

it("starts at natural size and the reference vertical offset, then leaves user pan and zoom alone", () => {
  const view = render(<ResponsiveViewport reveal={{ id: "start", nonce: 0 }} />);
  expect(flow.setViewport).toHaveBeenCalledWith({ x: 290, y: 150, zoom: 1 }, { duration: 0 });
  expect(flow.fitView).not.toHaveBeenCalled();
  view.rerender(<ResponsiveViewport reveal={{ id: "start", nonce: 0 }} />);
  expect(flow.setViewport).toHaveBeenCalledTimes(1);
});

it("does not set a viewport while there are no measured workflow nodes", () => {
  flow.nodes = [];
  render(<ResponsiveViewport />);
  expect(flow.setViewport).not.toHaveBeenCalled();
  expect(flow.fitView).not.toHaveBeenCalled();
});

it("preserves an early user pan or zoom while the first measurements settle", () => {
  flow.viewport = { x: 80, y: 90, zoom: 0.8 };
  render(<ResponsiveViewport reveal={{ id: "start", nonce: 0 }} />);
  expect(flow.setViewport).not.toHaveBeenCalled();
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
