// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { NodeInspector } from "./NodeInspector";

afterEach(cleanup);
it.each(["fa", "de"] as const)(
  "edits a task without exposing technical configuration in %s",
  (locale) => {
    const definition = initialDefinition({
      start: "Start",
      read: "Read",
      task: "Task",
      subject: "Follow up",
    });
    const node = definition.nodes[2]!;
    const onChange = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <NodeInspector
          definition={definition}
          node={node}
          editable
          onChange={onChange}
          onRemove={vi.fn()}
        />
      </LocaleProvider>,
    );
    const label = locale === "fa" ? "عنوان کار" : "Aufgabentitel";
    fireEvent.change(screen.getByLabelText(label), { target: { value: "پیگیری پیشنهاد" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ subject: { kind: "value", value: "پیگیری پیشنهاد" } }),
      }),
    );
    expect(screen.queryByText(/JSON/)).not.toBeInTheDocument();
  },
);
