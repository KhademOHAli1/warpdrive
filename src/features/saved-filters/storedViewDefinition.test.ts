import { describe, expect, it } from "vitest";
import { storedViewDefinition } from "./storedViewDefinition";

describe("stored view response compatibility", () => {
  it("keeps a malformed persisted row unavailable rather than emitting an empty filter", () => {
    const raw = { conditions: [{ field: "title", op: "future-op", value: "private-text" }] };
    const response = storedViewDefinition("deal", raw);
    expect(response).toEqual({
      availability: "unavailable",
      definition: null,
      problem: { kind: "unsupported", code: "unsupported-operator" },
    });
    expect(JSON.stringify(response)).not.toContain("private-text");
    expect(raw.conditions).toHaveLength(1);
  });
  it("retains valid bare and V1 entity-specific definitions", () => {
    const definition = { conditions: [{ field: "primaryEmail", op: "contains", value: "ali" }] };
    expect(storedViewDefinition("person", definition)).toEqual({
      availability: "available",
      definition: { combinator: "and", ...definition },
    });
    expect(
      storedViewDefinition("person", { version: 1, targetEntity: "person", definition }),
    ).toEqual(storedViewDefinition("person", definition));
  });
});
