// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { validateDefinition } from "../definition";
import { initialBlankDefinition } from "../editorModel";
import { delayMinutesSchema } from "../registry";
import { bindingSchema, type WorkflowDefinition } from "../schemas";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { paletteWorkflowId, readyPaletteRead } from "./palette.TestHelpers";

vi.mock("./useWorkflowConfigurationReferences", () => ({
  useWorkflowConfigurationReferences: () => ({
    status: "ready",
    options: [],
    search: "",
    onSearch: vi.fn(),
    nextCursor: null,
    selected: undefined,
    unavailable: false,
    stale: false,
  }),
}));
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: () => ({
    metadata: { status: "complete", defs: [] },
    authoring: true,
    busy: false,
    loadMore: undefined,
    retry: () => Promise.resolve(),
  }),
}));

vi.mock("@/features/workflows/ui/WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas omitted from authoring regression</div>,
}));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows/test",
}));

afterEach(cleanup);

function Workspace({ onChange }: { onChange: (definition: WorkflowDefinition) => void }) {
  const [definition, setDefinition] = useState(() => initialBlankDefinition("Manual start"));
  useEffect(() => onChange(definition), [definition, onChange]);
  return (
    <BuilderWorkspace
      workflowId={paletteWorkflowId}
      paletteRead={readyPaletteRead()}
      definition={definition}
      onChange={setDefinition}
      editable
      issues={[]}
    />
  );
}

it.each([
  {
    locale: "en",
    wait: "Wait",
    start: "Manual start",
    add: "Add a new connected step",
    search: "Search steps",
    steps: "Workflow steps",
    configure: "Configure",
    stepName: "Step name",
    duration: "Wait duration (minutes)",
  },
  {
    locale: "fa",
    wait: "انتظار",
    start: "شروع دستی",
    add: "افزودن و اتصال گام جدید",
    search: "جست‌وجوی گام‌ها",
    steps: "مراحل گردش‌کار",
    configure: "تنظیمات",
    stepName: "نام مرحله",
    duration: "مدت انتظار (دقیقه)",
  },
  {
    locale: "de",
    wait: "Warten",
    start: "Manueller Start",
    add: "Neuen Schritt verbinden",
    search: "Schritte suchen",
    steps: "Workflow-Schritte",
    configure: "Konfiguration",
    stepName: "Schrittname",
    duration: "Wartezeit (Minuten)",
  },
] as const)(
  "inserts a localized literal wait and focuses its inspector in $locale",
  async (copy) => {
    const onChange = vi.fn<(definition: WorkflowDefinition) => void>();
    render(
      <LocaleProvider locale={copy.locale}>
        <Workspace onChange={onChange} />
      </LocaleProvider>,
    );
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole("navigation", { name: copy.steps })).getByRole("button", {
        name: new RegExp(copy.start),
      }),
    );
    screen.getByRole("button", { name: copy.add }).focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    const choice = within(dialog).getByRole("button", { name: new RegExp(copy.wait) });
    choice.focus();
    expect(choice).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
      timeout: 1000,
      onTimeout: (error) => error,
    });

    const definition = onChange.mock.lastCall?.[0];
    if (definition === undefined) throw new Error("Insertion did not produce a definition");
    expect(definition.nodes).toHaveLength(2);
    const wait = definition.nodes.find((node) => node.type === "delay");
    if (wait === undefined) throw new Error("The chosen wait was not inserted");
    expect(wait).toMatchObject({
      type: "delay",
      version: 1,
      name: copy.wait,
      nameMode: "automatic",
    });
    const binding = bindingSchema.safeParse(wait.config.minutes);
    if (!binding.success || binding.data.kind !== "value")
      throw new Error("A new duration wait must use a literal binding");
    const minutes = delayMinutesSchema.safeParse(binding.data.value);
    if (!minutes.success) throw new Error("A new duration wait must use valid whole minutes");
    expect(wait.config).toEqual({ minutes: { kind: "value", value: minutes.data } });
    expect(definition.edges).toEqual([{ from: "start", to: wait.id, port: "next" }]);
    expect(validateDefinition(definition).ok).toBe(true);

    const steps = screen.getByRole("navigation", { name: copy.steps });
    expect(
      within(steps).getByRole("button", { name: new RegExp(copy.wait), pressed: true }),
    ).toBeInTheDocument();
    const inspector = screen.getByRole("region", { name: copy.configure });
    const stepName = within(inspector).getByRole("textbox", { name: copy.stepName });
    expect(stepName).toHaveValue(copy.wait);
    expect(within(inspector).getByLabelText(copy.duration)).toHaveValue(String(minutes.data));
    await waitFor(() => expect(stepName).toHaveFocus(), {
      timeout: 1000,
      onTimeout: (error) => error,
    });

    await user.click(within(steps).getByRole("button", { name: new RegExp(copy.start) }));
    expect(screen.queryByLabelText(copy.duration)).not.toBeInTheDocument();
    await user.click(within(steps).getByRole("button", { name: new RegExp(copy.wait) }));
    expect(screen.getByLabelText(copy.duration)).toHaveValue(String(minutes.data));
    expect(onChange.mock.lastCall?.[0]).toBe(definition);
  },
);
