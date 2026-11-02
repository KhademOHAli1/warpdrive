// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as rawRender, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { clearRetainedCreation, readRetainedCreation } from "./retainedCreation";

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function render(ui: ReactNode) {
  return rawRender(ui, {
    wrapper: ({ children }) => (
      <NativeActorProvider key={ACTOR} actorId={ACTOR}>
        {children}
      </NativeActorProvider>
    ),
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  const pending = readRetainedCreation(ACTOR);
  if (pending !== null) clearRetainedCreation(ACTOR, pending.id);
  vi.clearAllMocks();
});

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        deal: {
          board: {
            query: () =>
              Promise.resolve({
                cards: [{ id: "d1", writeVersion: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
              }),
          },
        },
      },
    }),
    contacts: {
      personOptions: { useQuery: () => ({ data: [] }) },
      orgOptions: { useQuery: () => ({ data: [] }) },
    },
    labels: { listByTarget: { useQuery: () => ({ data: [] }) } },
    identity: {
      listUsers: { useQuery: () => ({ data: undefined }) },
      listVisibilityGroups: { useQuery: () => ({ data: undefined }) },
    },
    customFields: { listDefs: { useQuery: () => ({ data: [] }) } },
  },
}));

const { createDealAction } = vi.hoisted(() => ({
  createDealAction: vi.fn(() => Promise.resolve({ ok: true as const, deal: null })),
}));
vi.mock("./nativeCreateAction", () => ({
  createNativeDealAction: createDealAction,
  readNativeDealCreationAction: vi.fn(),
}));
vi.mock("./nativeContactActions", () => ({
  createDealOrgAction: vi.fn(),
  createDealPersonAction: vi.fn(),
}));
vi.mock("@/features/contacts/actions", () => ({
  createPersonAction: vi.fn(),
  createOrgAction: vi.fn(),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, refresh: vi.fn() }) }));

import {
  INTERFACE_PREFS_DEFAULT,
  InterfacePrefsProvider,
} from "@/features/identity/InterfacePrefsProvider";
import { AddDealModal } from "./AddDealModal";

const PIPE = "11111111-1111-4111-8111-111111111111";
const STAGE_A = "22222222-2222-4222-8222-222222222222";

describe("AddDealModal when the created deal is hidden from its creator", () => {
  it("tells the creator the deal was created but is hidden from them, and closes on OK", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(
      <InterfacePrefsProvider
        value={{
          ...INTERFACE_PREFS_DEFAULT,
          openDetailsAfterCreate: { leadDeal: true, person: false, org: false },
        }}
      >
        <QueryClientProvider client={new QueryClient()}>
          <AddDealModal
            pipelineId={PIPE}
            pipelines={[{ id: PIPE, name: "Sales", stages: [{ id: STAGE_A, name: "Qualified" }] }]}
            onClose={onClose}
            onCreated={onCreated}
          />
        </QueryClientProvider>
      </InterfacePrefsProvider>,
    );
    fireEvent.change(screen.getByLabelText("Deal title"), { target: { value: "Handed away" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const notice = await screen.findByRole("alertdialog");
    expect(notice).toHaveTextContent("Deal created, but you can't see it");
    expect(notice).toHaveTextContent("Handed away");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(routerPush).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.queryByText(/Could not create deal/)).toBeNull();
  });
});
