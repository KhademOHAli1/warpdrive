// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const PIPELINE_ID = "00000000-0000-4000-8000-000000000002";
const { byId, stageDealCounts } = vi.hoisted(() => ({ byId: vi.fn(), stageDealCounts: vi.fn() }));
vi.mock("@/features/deals/salesStrings", () => ({
  createSalesStrings: () => ({ titles: { editPipeline: "Edit pipeline" } }),
}));
vi.mock("@/features/i18n/server", () => ({
  getAppTranslations: () => Promise.resolve((key: string) => key),
  getLocalePreferences: () => Promise.resolve({ locale: "en" }),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: { id: "viewer" } }),
}));
vi.mock("@/server/trpc/root", () => ({
  createCaller: () => ({ pipeline: { byId, stageDealCounts } }),
}));
vi.mock("@/features/pipelines/EditPipelineClient", () => ({
  EditPipelineClient: ({
    pipelineId,
    returnToSettings,
  }: {
    pipelineId: string;
    returnToSettings?: boolean;
  }) => (
    <output
      data-testid="editor"
      data-pipeline={pipelineId}
      data-settings={String(returnToSettings ?? false)}
    />
  ),
}));

import EditPipelinePage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  { label: "missing origin", from: undefined, settings: false },
  { label: "finite settings origin", from: "settings", settings: true },
  { label: "arbitrary origin URL", from: "https://example.invalid/return", settings: false },
  { label: "repeated settings origin", from: ["settings", "settings"], settings: false },
])("keeps the selected pipeline and recognizes only $label", async ({ from, settings }) => {
  byId.mockResolvedValue({
    id: PIPELINE_ID,
    name: "Selected pipeline",
    updatedAt: new Date("2026-10-31T12:00:00Z"),
    stages: [],
  });
  stageDealCounts.mockResolvedValue({});
  const props = {
    params: Promise.resolve({ id: PIPELINE_ID }),
    searchParams: Promise.resolve(from === undefined ? {} : { from }),
  };
  render(await EditPipelinePage(props));
  expect(screen.getByTestId("editor")).toHaveAttribute("data-pipeline", PIPELINE_ID);
  expect(screen.getByTestId("editor")).toHaveAttribute("data-settings", String(settings));
  expect(byId).toHaveBeenCalledExactlyOnceWith(PIPELINE_ID);
  expect(stageDealCounts).toHaveBeenCalledExactlyOnceWith(PIPELINE_ID);
});
