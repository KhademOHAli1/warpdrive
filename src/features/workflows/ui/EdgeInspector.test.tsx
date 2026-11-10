// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { initialDefinition } from "../editorModel";
import { EdgeInspector } from "./EdgeInspector";

afterEach(cleanup);

it("closes a read-only connection inspector without reconnecting or disconnecting", () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <EdgeInspector
      definition={definition}
      edge={definition.edges[0]!}
      editable={false}
      onChange={onChange}
      onProblem={vi.fn()}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Source node" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
});
