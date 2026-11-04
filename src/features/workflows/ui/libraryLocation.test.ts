import { describe, expect, it } from "vitest";
import {
  buildLibraryLocation,
  defaultLibraryLocation,
  parseLibraryLocation,
  sanitizeLibraryReturnTo,
  workflowLocation,
} from "./libraryLocation";

const workflowId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const ownerId = "ebecb692-dca5-49f4-96d7-4cf95bd623d9";
const context = {
  ...defaultLibraryLocation(),
  query: "Rückruf مشتری",
  status: "active" as const,
  ownerId,
  health: "latest-live-failed" as const,
  sort: "name-desc" as const,
  limit: 50,
};

// Post-implementation coverage amendment. These pure cases do not establish a
// tests-first baseline, actual navigation, server cursor validity or authorization.
describe("workflow library return context", () => {
  it.each([
    ["external URL", "https://outside.invalid/workflows?query=Keep"],
    ["protocol-relative URL", "//outside.invalid/workflows?query=Keep"],
    ["backslash-normalized external URL", "/\\outside.invalid/workflows?query=Keep"],
    ["other application path", "/deals?query=Keep"],
    ["library path prefix", "/workflows-extra?query=Keep"],
    ["fragment", "/workflows?query=Keep#history"],
    ["unknown key", "/workflows?query=Keep&redirect=elsewhere"],
    ["duplicate query key", "/workflows?query=First&query=Second"],
    ["duplicate known default", "/workflows?query=Keep&limit=25&limit=25"],
  ] as const)("rejects %s rather than retaining unvalidated return state", (_label, value) => {
    expect(sanitizeLibraryReturnTo(value)).toBe("/workflows");
  });

  it("rejects non-string and oversized return values", () => {
    for (const raw of [undefined, null, 42, {}, `/workflows?query=${"x".repeat(8193)}`]) {
      expect(sanitizeLibraryReturnTo(raw)).toBe("/workflows");
    }
  });

  it("round-trips valid library filters without granting a different route or owner scope", () => {
    const location = buildLibraryLocation(context);
    expect(sanitizeLibraryReturnTo(location)).toBe(location);
    expect(parseLibraryLocation(location)).toEqual(context);
    expect(new URL(location, "https://workflow.invalid").pathname).toBe("/workflows");
  });

  it.each(["!not-base64url", "x".repeat(4097), ""])(
    "drops an unusable or empty continuation while retaining valid filters",
    (cursor) => {
      const location = buildLibraryLocation(context);
      const withCursor = `${location}&cursor=${encodeURIComponent(cursor)}`;
      expect(sanitizeLibraryReturnTo(withCursor)).toBe(location);
      expect(parseLibraryLocation(sanitizeLibraryReturnTo(withCursor))).toEqual(context);
    },
  );

  it("normalizes bounded query/UUID/default values and rejects out-of-range filters", () => {
    const params = new URLSearchParams({
      query: `  ${"x".repeat(200)}  `,
      ownerId: ownerId.toUpperCase(),
      limit: "100",
      archive: "current",
      status: "all",
      health: "all",
      sort: "updated-desc",
    });
    const normalized = sanitizeLibraryReturnTo(`/workflows?${params.toString()}`);
    expect(parseLibraryLocation(normalized)).toEqual({
      ...defaultLibraryLocation(),
      query: "x".repeat(200),
      ownerId,
      limit: 100,
    });
    expect(new URL(normalized, "https://workflow.invalid").searchParams.has("status")).toBe(false);
    const invalidParameters: Record<string, string>[] = [
      { query: "x".repeat(201) },
      { query: "\0" },
      { ownerId: "not-a-uuid" },
      { limit: "0" },
      { limit: "101" },
      { sort: "random" },
    ];
    for (const invalid of invalidParameters) {
      expect(sanitizeLibraryReturnTo(`/workflows?${new URLSearchParams(invalid).toString()}`)).toBe(
        "/workflows",
      );
    }
  });

  it("treats URL-like search text as data inside the permitted library path", () => {
    const location = buildLibraryLocation({
      ...defaultLibraryLocation(),
      query: "https://outside.invalid/customer",
    });
    expect(sanitizeLibraryReturnTo(location)).toBe(location);
    expect(new URL(location, "https://workflow.invalid").origin).toBe("https://workflow.invalid");
    expect(parseLibraryLocation(location).query).toBe("https://outside.invalid/customer");
  });
});

describe("workflow detail destinations", () => {
  it("preserves only a validated internal return context and the explicit history flag", () => {
    const returnTo = buildLibraryLocation(context);
    const target = new URL(
      workflowLocation(workflowId, returnTo, true),
      "https://workflow.invalid",
    );
    expect(target.pathname).toBe(`/workflows/${workflowId}`);
    expect(target.searchParams.get("history")).toBe("1");
    expect(target.searchParams.get("returnTo")).toBe(returnTo);
    expect(sanitizeLibraryReturnTo(target.searchParams.get("returnTo"))).toBe(returnTo);
  });

  it("discards an external return target while retaining the valid workflow destination", () => {
    expect(workflowLocation(workflowId, "https://outside.invalid/workflows?query=Keep")).toBe(
      `/workflows/${workflowId}`,
    );
  });

  it("rejects malformed workflow IDs instead of constructing a path", () => {
    for (const id of ["not-a-uuid", "../deals", `${workflowId}/run`]) {
      expect(workflowLocation(id, buildLibraryLocation(context), true)).toBe("/workflows");
    }
  });
});
