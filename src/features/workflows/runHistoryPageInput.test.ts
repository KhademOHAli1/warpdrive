import { describe, expect, it } from "vitest";
import { runHistoryPageInputSchema } from "./runHistoryPageInput";
import { historyModeFilters, historyStatusFilters, RUN_HISTORY_PAGE_SIZE } from "./runHistoryTypes";

const id = "CB001F5A-B8A4-49FC-88D9-ECCB94C9A773";

describe("strict fixed-size run-history page input", () => {
  it("normalizes omitted filters and the workflow UUID without mutating input", () => {
    const input = Object.freeze({ id });
    expect(runHistoryPageInputSchema.parse(input)).toEqual({
      id: id.toLowerCase(),
      status: "all",
      mode: "all",
    });
    expect(input).toEqual({ id });
    expect(RUN_HISTORY_PAGE_SIZE).toBe(50);
  });

  const combinations = historyStatusFilters.flatMap((status) =>
    historyModeFilters.map((mode) => ({ status, mode })),
  );
  it.each(combinations)("retains canonical status $status and mode $mode", (filters) => {
    expect(runHistoryPageInputSchema.parse({ id, ...filters })).toEqual({
      id: id.toLowerCase(),
      ...filters,
    });
  });

  it("retains a bounded opaque cursor for decoding after current authorization", () => {
    expect(runHistoryPageInputSchema.parse({ id, cursor: "!malformed-but-bounded" })).toEqual({
      id: id.toLowerCase(),
      status: "all",
      mode: "all",
      cursor: "!malformed-but-bounded",
    });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { id: "missing-uuid" },
    { id, status: "pending" },
    { id, mode: "dry-run" },
    { id, status: null },
    { id, mode: null },
    { id, cursor: null },
    { id, cursor: 1 },
    { id, cursor: "" },
    { id, cursor: "A".repeat(4097) },
    { id, limit: 100 },
    { id, ownerId: id },
    { id, sort: "updated-desc" },
  ])("rejects unreviewed or malformed input %j", (raw) => {
    expect(runHistoryPageInputSchema.safeParse(raw).success).toBe(false);
  });
});
