// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelineSelect } from "./PipelineSelect";

afterEach(cleanup);

const PIPELINES = [
  { id: "p1", name: "Sales" },
  { id: "p2", name: "Partnerships" },
];

describe("PipelineSelect", () => {
  it("lists every visible pipeline as a board destination and includes Performance", async () => {
    const user = userEvent.setup();
    render(<PipelineSelect pipelineId="p1" pipelines={PIPELINES} />);
    await user.click(screen.getByRole("button", { name: /Sales/ }));
    expect(screen.getByRole("menuitem", { name: "Partnerships" })).toHaveAttribute(
      "href",
      "/pipeline/p2",
    );
    expect(screen.getByRole("menuitem", { name: "Performance" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("offers a new deal view while retaining destinations for the current layout", async () => {
    const user = userEvent.setup();
    const addView = vi.fn();
    render(
      <PipelineSelect
        pipelineId="p1"
        pipelines={PIPELINES}
        activeView="list"
        onAddView={addView}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Sales/ });
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Partnerships" })).toHaveAttribute(
      "href",
      "/pipeline/p2/list",
    );
    await user.click(screen.getByRole("menuitem", { name: "Add new view" }));
    expect(addView).toHaveBeenCalledWith(trigger);
  });
});
