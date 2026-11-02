// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { CurrencyProvider } from "@/features/currencies/CurrencyProvider";
import { AddDealModal } from "@/features/deals/AddDealModal";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { AddLeadModal } from "@/features/leads/AddLeadModal";
import type { CustomFieldDef } from "@/types/customFields";
import { CustomFieldCreateFields } from "./CustomFieldCreateFields";
import { CustomFieldDetail, CustomFieldFormControl } from "./render.widgets";

const { modalDefs } = vi.hoisted(() => ({ modalDefs: [] as CustomFieldDef[] }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    contacts: {
      personOptions: { useQuery: () => ({ data: [] }) },
      orgOptions: { useQuery: () => ({ data: [] }) },
    },
    labels: { listByTarget: { useQuery: () => ({ data: [] }) } },
    identity: {
      listUsers: { useQuery: () => ({ data: undefined }) },
      listVisibilityGroups: { useQuery: () => ({ data: undefined }) },
      assignableUsers: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    customFields: {
      listDefs: {
        useQuery: ({ target }: { target: string }) => ({
          data: modalDefs.filter((def) => def.targetEntity === target),
        }),
      },
    },
  },
}));
vi.mock("@/features/deals/createDealAction", () => ({ createDealAction: vi.fn() }));
vi.mock("@/features/leads/leadServerActions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/features/contacts/actions", () => ({
  createPersonAction: vi.fn(),
  createOrgAction: vi.fn(),
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "test-csrf" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
const queryClients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of queryClients.splice(0)) client.clear();
  modalDefs.splice(0);
  vi.clearAllMocks();
});

function budget(targetEntity: CustomFieldDef["targetEntity"]): CustomFieldDef {
  return {
    id: `field-${targetEntity}-budget`,
    targetEntity,
    type: "monetary",
    name: "Budget",
    key: "budget",
    options: [],
    isRequired: false,
    isImportant: false,
    showInAddForm: true,
    order: 0,
    archivedAt: null,
  };
}

function describedTargets(input: HTMLElement) {
  const ids = input.getAttribute("aria-describedby")?.split(/\s+/u) ?? [];
  expect(ids.length).toBeGreaterThan(0);
  return ids.map((id) => {
    const matches = Array.from(document.querySelectorAll<HTMLElement>("[id]")).filter(
      (element) => element.id === id,
    );
    expect(matches).toHaveLength(1);
    return matches[0];
  });
}

function expectDistinctControls(inputs: HTMLElement[]) {
  expect(inputs.every((input) => input.id.length > 0)).toBe(true);
  expect(new Set(inputs.map((input) => input.id)).size).toBe(inputs.length);
  for (const input of inputs) describedTargets(input);
}

it("keeps same-key entity hints and a validation error attached to their own control", () => {
  const entities = ["person", "organization", "deal"] as const;
  const currencies = ["IRR", "EUR", "USD"] as const;
  const view = (invalid: boolean) => (
    <LocaleProvider locale="de" iranianMoneyUnit="toman">
      <CurrencyProvider currency="EUR">
        {entities.map((entity, index) => (
          <CustomFieldCreateFields
            key={entity}
            title={`${entity} fields`}
            defs={[budget(entity)]}
            values={{ budget: invalid && entity === "organization" ? "not-an-amount" : 1 }}
            currency={currencies[index]}
            onChange={vi.fn()}
          />
        ))}
      </CurrencyProvider>
    </LocaleProvider>
  );
  const rendered = render(view(true));
  const inputs = entities.map((entity) =>
    within(screen.getByRole("group", { name: `${entity} fields` })).getByRole("textbox", {
      name: "Budget",
    }),
  );
  expectDistinctControls(inputs);
  const alert = screen.getByRole("alert");
  expect(alert.id).not.toBe("");
  for (const [index, input] of inputs.entries()) {
    expect(input).toHaveAccessibleDescription(new RegExp(currencies[index] ?? "missing"));
    const targets = describedTargets(input);
    expect(targets.includes(alert)).toBe(index === 1);
  }
  expect(inputs[1]).toHaveAttribute("aria-invalid", "true");
  const originalIds = inputs.map((input) => input.id);
  rendered.rerender(view(false));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getAllByRole("textbox", { name: "Budget" }).map((input) => input.id)).toEqual(
    originalIds,
  );
});

it.each(["deal", "lead"] as const)(
  "%s add form mounts three same-key Budget controls with unique canonical descriptions",
  (entity) => {
    modalDefs.push(budget("person"), budget("organization"), budget(entity));
    const client = new QueryClient();
    queryClients.push(client);
    render(
      <LocaleProvider locale="en" iranianMoneyUnit="toman">
        <CurrencyProvider currency="EUR">
          <QueryClientProvider client={client}>
            {entity === "deal" ? (
              <NativeActorProvider
                key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                actorId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
              >
                <AddDealModal
                  baseCurrency="IRR"
                  pipelineId="11111111-1111-4111-8111-111111111111"
                  pipelines={[]}
                  onClose={vi.fn()}
                  onCreated={vi.fn()}
                />
              </NativeActorProvider>
            ) : (
              <AddLeadModal baseCurrency="IRR" onClose={vi.fn()} onCreated={vi.fn()} />
            )}
          </QueryClientProvider>
        </CurrencyProvider>
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText("Contact person"), { target: { value: "New person" } });
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "New organization" },
    });
    const inputs = screen.getAllByRole("textbox", { name: "Budget" });
    expect(inputs).toHaveLength(3);
    expectDistinctControls(inputs);
    for (const input of inputs) {
      expect(input).toHaveAccessibleDescription(/IRR/u);
      expect(input).not.toHaveAccessibleDescription(/EUR|Toman|تومان/u);
    }
  },
);

it("keeps ordinary numeric controls free of money descriptions", () => {
  render(
    <LocaleProvider locale="fa" iranianMoneyUnit="toman">
      <CurrencyProvider currency="IRR">
        <CustomFieldFormControl
          def={{ ...budget("deal"), type: "numeric" }}
          value={1}
          onChange={vi.fn()}
        />
      </CurrencyProvider>
    </LocaleProvider>,
  );
  expect(screen.getByRole("textbox", { name: "Budget" })).not.toHaveAccessibleDescription();
});

it("preserves a reachable exponent-form custom-field read value", () => {
  render(
    <LocaleProvider locale="en" iranianMoneyUnit="toman">
      <CurrencyProvider currency="IRR">
        <section aria-label="numeric amount">
          <CustomFieldDetail def={budget("deal")} value={1e21} currency="IRR" />
        </section>
        <section aria-label="expanded amount">
          <CustomFieldDetail def={budget("deal")} value="1000000000000000000000" currency="IRR" />
        </section>
      </CurrencyProvider>
    </LocaleProvider>,
  );
  const numeric = screen.getByRole("region", { name: "numeric amount" }).textContent;
  const expanded = screen.getByRole("region", { name: "expanded amount" }).textContent;
  expect(numeric).not.toBe("");
  expect(numeric).toBe(expanded);
});
