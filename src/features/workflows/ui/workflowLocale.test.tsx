// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { useWorkflowEditor, type WorkflowDetail } from "./useWorkflowEditor";

const deps = vi.hoisted(() => ({ save: vi.fn(), publish: vi.fn() }));
vi.mock("../actions", () => ({
  saveWorkflowAction: deps.save,
  publishWorkflowAction: deps.publish,
  pauseWorkflowAction: vi.fn(),
}));
afterEach(cleanup);

it("retranslates feedback on a live language switch without losing the draft", async () => {
  const initial: WorkflowDetail = {
    id: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    name: "Draft",
    revision: 1,
    draft: initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" }),
    active: false,
    publishedNumber: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    capabilities: { edit: true, publish: true, run: true, cancel: true },
  };
  let locale: "en" | "fa" | "de" = "en";
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LocaleProvider locale={locale}>{children}</LocaleProvider>
  );
  const { result, rerender } = renderHook(() => useWorkflowEditor(initial), { wrapper });
  deps.publish.mockResolvedValue({ ok: false, error: "E_WORKFLOW_003" });
  await act(() => result.current.perform("publish"));
  expect(result.current.error).toContain("another window");
  act(() => result.current.setName("پیشنهاد مشتری"));
  locale = "fa";
  rerender();
  expect(result.current.error).toContain("پنجره دیگری");
  expect(result.current.name).toBe("پیشنهاد مشتری");
  expect(result.current.dirty).toBe(true);
  locale = "de";
  rerender();
  expect(result.current.error).toContain("anderen Fenster");
  expect(result.current.name).toBe("پیشنهاد مشتری");
});
