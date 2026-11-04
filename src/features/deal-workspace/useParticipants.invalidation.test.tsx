// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

type ParticipantResult = { ok: true } | { ok: false; error: { id: string } };

const {
  invalidatePersonOptions,
  invalidatePeopleForOrg,
  invalidateParticipants,
  refresh,
  createPerson,
  addParticipant,
  removeParticipant,
} = vi.hoisted(() => ({
  invalidatePersonOptions: vi.fn<() => Promise<void>>(),
  invalidatePeopleForOrg: vi.fn<() => Promise<void>>(),
  invalidateParticipants: vi.fn<() => Promise<void>>(),
  refresh: vi.fn<() => void>(),
  createPerson: vi.fn(),
  addParticipant: vi.fn<() => Promise<ParticipantResult>>(),
  removeParticipant: vi.fn<() => Promise<ParticipantResult>>(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      deal: { participants: { invalidate: invalidateParticipants } },
      contacts: {
        personOptions: { invalidate: invalidatePersonOptions },
        listPeopleForOrg: { invalidate: invalidatePeopleForOrg },
      },
    }),
    deal: { participants: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/contacts/actions", () => ({
  createPersonAction: createPerson,
}));
vi.mock("./actions", () => ({
  addParticipantAction: addParticipant,
  removeParticipantAction: removeParticipant,
}));

import { useParticipants } from "./useParticipants";

beforeEach(() => {
  vi.resetAllMocks();
  invalidatePersonOptions.mockResolvedValue(undefined);
  invalidatePeopleForOrg.mockResolvedValue(undefined);
  invalidateParticipants.mockResolvedValue(undefined);
  createPerson.mockResolvedValue({ ok: true, value: { id: "pnew" } });
  addParticipant.mockResolvedValue({ ok: true });
  removeParticipant.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

function Harness({ orgId }: { orgId: string | null }) {
  const { createAndAdd } = useParticipants("d1", orgId);
  return (
    <button type="button" onClick={() => void createAndAdd("Dana Whitfield")}>
      create
    </button>
  );
}

it("refreshes the organization's people after creating and linking one of them", async () => {
  render(<Harness orgId="o1" />);
  await userEvent.click(screen.getByRole("button", { name: "create" }));
  await waitFor(() => expect(invalidatePersonOptions).toHaveBeenCalled());
  expect(invalidatePeopleForOrg).toHaveBeenCalledWith({ orgId: "o1" });
});

it("skips the organization refresh when the deal has no organization", async () => {
  render(<Harness orgId={null} />);
  await userEvent.click(screen.getByRole("button", { name: "create" }));
  await waitFor(() => expect(invalidatePersonOptions).toHaveBeenCalled());
  expect(invalidatePeopleForOrg).not.toHaveBeenCalled();
});

function expectOnlyMutation(mutation: "add" | "remove") {
  if (mutation === "add") {
    expect(addParticipant).toHaveBeenCalledTimes(1);
    expect(addParticipant).toHaveBeenCalledWith(
      { dealId: "d1", personId: "p1", role: null },
      "csrf",
    );
    expect(removeParticipant).not.toHaveBeenCalled();
  } else {
    expect(removeParticipant).toHaveBeenCalledTimes(1);
    expect(removeParticipant).toHaveBeenCalledWith({ dealId: "d1", personId: "p1" }, "csrf");
    expect(addParticipant).not.toHaveBeenCalled();
  }
  expect(createPerson).not.toHaveBeenCalled();
  expect(invalidatePersonOptions).not.toHaveBeenCalled();
  expect(invalidatePeopleForOrg).not.toHaveBeenCalled();
}

for (const mutation of ["add", "remove"] as const) {
  it.each(["cache invalidation", "synchronous cache invalidation", "page refresh"] as const)(
    `keeps an acknowledged ${mutation} successful when %s fails without repeating the write`,
    async (failure) => {
      if (failure === "cache invalidation") {
        invalidateParticipants.mockRejectedValueOnce(new Error("cache unavailable"));
      } else if (failure === "synchronous cache invalidation") {
        invalidateParticipants.mockImplementationOnce(() => {
          throw new Error("cache unavailable");
        });
      } else {
        refresh.mockImplementationOnce(() => {
          throw new Error("page unavailable");
        });
      }
      const { result } = renderHook(() => useParticipants("d1", "o1"));

      await expect(result.current[mutation]("p1")).resolves.toBeNull();

      expectOnlyMutation(mutation);
      expect(invalidateParticipants).toHaveBeenCalledTimes(1);
      expect(invalidateParticipants).toHaveBeenCalledWith({ dealId: "d1" });
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it(`waits for the ${mutation} acknowledgement and cache settlement before refreshing the page`, async () => {
    const action = mutation === "add" ? addParticipant : removeParticipant;
    let acknowledge!: (value: ParticipantResult) => void;
    const acknowledgement = new Promise<ParticipantResult>((resolve) => {
      acknowledge = resolve;
    });
    let finishInvalidation!: () => void;
    const invalidation = new Promise<void>((resolve) => {
      finishInvalidation = resolve;
    });
    action.mockReturnValueOnce(acknowledgement);
    invalidateParticipants.mockReturnValueOnce(invalidation);
    const { result } = renderHook(() => useParticipants("d1", "o1"));

    const completion = result.current[mutation]("p1");

    expectOnlyMutation(mutation);
    expect(invalidateParticipants).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    acknowledge({ ok: true });
    await waitFor(() => expect(invalidateParticipants).toHaveBeenCalledTimes(1));
    expect(invalidateParticipants).toHaveBeenCalledWith({ dealId: "d1" });
    expect(refresh).not.toHaveBeenCalled();

    finishInvalidation();
    await expect(completion).resolves.toBeNull();

    expectOnlyMutation(mutation);
    expect(invalidateParticipants).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it(`preserves the returned ${mutation} action failure without refreshing`, async () => {
    const action = mutation === "add" ? addParticipant : removeParticipant;
    action.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    const { result } = renderHook(() => useParticipants("d1", "o1"));

    await expect(result.current[mutation]("p1")).resolves.toContain("E_PERM_001");

    expectOnlyMutation(mutation);
    expect(invalidateParticipants).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it(`preserves a genuine ${mutation} action rejection without refreshing`, async () => {
    const action = mutation === "add" ? addParticipant : removeParticipant;
    const rejection = new Error("write unavailable");
    action.mockRejectedValueOnce(rejection);
    const { result } = renderHook(() => useParticipants("d1", "o1"));

    await expect(result.current[mutation]("p1")).rejects.toBe(rejection);

    expectOnlyMutation(mutation);
    expect(invalidateParticipants).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
}

type ContactRefresh = "person options" | "organization people";
type RefreshFailure = "synchronous throw" | "rejection";

function failContactRefresh(query: ContactRefresh, failure: RefreshFailure) {
  const invalidate = query === "person options" ? invalidatePersonOptions : invalidatePeopleForOrg;
  const error = new Error(`${query} unavailable`);
  if (failure === "synchronous throw") {
    invalidate.mockImplementationOnce(() => {
      throw error;
    });
  } else {
    invalidate.mockRejectedValueOnce(error);
  }
}

function renderCreateParticipants(orgId: string | null) {
  return renderHook(() => ({
    ...useParticipants("d1", orgId),
    translateSales: useAppTranslations("sales"),
  }));
}

function expectCreatedOnce(orgId: string | null) {
  expect(createPerson).toHaveBeenCalledTimes(1);
  expect(createPerson).toHaveBeenCalledWith(
    { name: "Dana Whitfield", orgId, emails: [], phones: [], customFields: {} },
    "csrf",
  );
  expect(removeParticipant).not.toHaveBeenCalled();
}

function expectCreatedPersonLinkedOnce(orgId: string | null) {
  expectCreatedOnce(orgId);
  expect(addParticipant).toHaveBeenCalledTimes(1);
  expect(addParticipant).toHaveBeenCalledWith(
    { dealId: "d1", personId: "p-created-42", role: null },
    "csrf",
  );
  expect(invalidatePersonOptions).toHaveBeenCalledTimes(1);
  expect(invalidatePersonOptions).toHaveBeenCalledWith();
  if (orgId === null) {
    expect(invalidatePeopleForOrg).not.toHaveBeenCalled();
  } else {
    expect(invalidatePeopleForOrg).toHaveBeenCalledTimes(1);
    expect(invalidatePeopleForOrg).toHaveBeenCalledWith({ orgId });
  }
}

it.each([
  { orgId: "o1", query: "person options", failure: "synchronous throw" },
  { orgId: "o1", query: "person options", failure: "rejection" },
  { orgId: "o1", query: "organization people", failure: "synchronous throw" },
  { orgId: "o1", query: "organization people", failure: "rejection" },
  { orgId: null, query: "person options", failure: "synchronous throw" },
  { orgId: null, query: "person options", failure: "rejection" },
] as const)(
  "links the acknowledged created ID once after $query $failure with organization $orgId",
  async ({ orgId, query, failure }) => {
    createPerson.mockResolvedValueOnce({ ok: true, value: { id: "p-created-42" } });
    failContactRefresh(query, failure);
    const { result } = renderCreateParticipants(orgId);

    await expect(result.current.createAndAdd("Dana Whitfield")).resolves.toBeNull();

    expectCreatedPersonLinkedOnce(orgId);
    expect(invalidateParticipants).toHaveBeenCalledTimes(1);
    expect(invalidateParticipants).toHaveBeenCalledWith({ dealId: "d1" });
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);

it.each(["person options", "organization people"] as const)(
  "preserves the created-but-unlinked result after %s refresh fails and linking fails",
  async (query) => {
    createPerson.mockResolvedValueOnce({ ok: true, value: { id: "p-created-42" } });
    failContactRefresh(query, "rejection");
    addParticipant.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    const { result } = renderCreateParticipants("o1");

    await expect(result.current.createAndAdd("Dana Whitfield")).resolves.toBe(
      result.current.translateSales("computed.personCreatedUnlinked", {
        name: "Dana Whitfield",
        id: "E_PERM_001",
      }),
    );

    expectCreatedPersonLinkedOnce("o1");
    expect(invalidateParticipants).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  },
);

it("preserves a failed create action result without linking or refreshing", async () => {
  createPerson.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
  const { result } = renderCreateParticipants("o1");

  await expect(result.current.createAndAdd("Dana Whitfield")).resolves.toBe(
    result.current.translateSales("computed.createPersonFailed", { id: "E_PERM_001" }),
  );

  expectCreatedOnce("o1");
  expect(addParticipant).not.toHaveBeenCalled();
  expect(invalidatePersonOptions).not.toHaveBeenCalled();
  expect(invalidatePeopleForOrg).not.toHaveBeenCalled();
  expect(invalidateParticipants).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it("preserves a genuine create action rejection without linking or refreshing", async () => {
  const rejection = new Error("create unavailable");
  createPerson.mockRejectedValueOnce(rejection);
  const { result } = renderCreateParticipants("o1");

  await expect(result.current.createAndAdd("Dana Whitfield")).rejects.toBe(rejection);

  expectCreatedOnce("o1");
  expect(addParticipant).not.toHaveBeenCalled();
  expect(invalidatePersonOptions).not.toHaveBeenCalled();
  expect(invalidatePeopleForOrg).not.toHaveBeenCalled();
  expect(invalidateParticipants).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it("waits for creation and linking acknowledgements before their respective refreshes", async () => {
  let acknowledgeCreate!: (value: { ok: true; value: { id: string } }) => void;
  const creation = new Promise<{ ok: true; value: { id: string } }>((resolve) => {
    acknowledgeCreate = resolve;
  });
  let acknowledgeLink!: (value: ParticipantResult) => void;
  const linking = new Promise<ParticipantResult>((resolve) => {
    acknowledgeLink = resolve;
  });
  createPerson.mockReturnValueOnce(creation);
  addParticipant.mockReturnValueOnce(linking);
  const { result } = renderCreateParticipants("o1");

  const completion = result.current.createAndAdd("Dana Whitfield");

  expectCreatedOnce("o1");
  expect(invalidatePersonOptions).not.toHaveBeenCalled();
  expect(invalidatePeopleForOrg).not.toHaveBeenCalled();
  expect(addParticipant).not.toHaveBeenCalled();
  expect(invalidateParticipants).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();

  acknowledgeCreate({ ok: true, value: { id: "p-created-42" } });
  await waitFor(() => expect(addParticipant).toHaveBeenCalledTimes(1));
  expectCreatedPersonLinkedOnce("o1");
  expect(invalidateParticipants).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();

  acknowledgeLink({ ok: true });
  await expect(completion).resolves.toBeNull();

  expectCreatedPersonLinkedOnce("o1");
  expect(invalidateParticipants).toHaveBeenCalledTimes(1);
  expect(invalidateParticipants).toHaveBeenCalledWith({ dealId: "d1" });
  expect(refresh).toHaveBeenCalledTimes(1);
});
