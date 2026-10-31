// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { useWorkflowEditor, type WorkflowDetail } from "./useWorkflowEditor";

const save = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({
  saveWorkflowAction: save,
  publishWorkflowAction: vi.fn(),
  pauseWorkflowAction: vi.fn(),
}));
afterEach(cleanup);

it("adopts normalized server content after saving so the editor is clean", async () => {
  const definition = initialDefinition({
    start: "Start",
    read: "Read deal",
    task: "Task",
    subject: "Follow up",
  });
  const initial: WorkflowDetail = {
    id: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    name: "Follow up",
    revision: 1,
    draft: definition,
    active: false,
    publishedNumber: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    capabilities: { edit: true, publish: true, run: true, cancel: true },
  };
  const { result } = renderHook(() => useWorkflowEditor(initial), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <LocaleProvider locale="fa">{children}</LocaleProvider>
    ),
  });
  const edited = structuredClone(definition);
  edited.nodes[1]!.name = "  Read deal  ";
  act(() => result.current.setDefinition(edited));
  expect(result.current.dirty).toBe(true);
  save.mockResolvedValue({ ok: true, value: { ...initial, revision: 2, draft: definition } });
  await act(() => result.current.perform("save"));
  expect(result.current.dirty).toBe(false);
  expect(result.current.definition.nodes[1]?.name).toBe("Read deal");
});
