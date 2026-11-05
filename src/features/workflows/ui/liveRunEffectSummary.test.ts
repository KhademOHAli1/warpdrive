import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { projectLiveRunEffects } from "./liveRunEffectSummary";

const customFieldId = "0c80835c-4b8e-4055-b27a-9ef094bd3015";

function sample(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Private start", config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Private record lookup",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      {
        id: "check",
        type: "condition",
        version: 1,
        name: "Private branch",
        config: {
          left: { kind: "reference", nodeId: "read", path: ["status"] },
          operator: "equals",
          right: { kind: "value", value: "Private branch literal" },
        },
      },
      {
        id: "matched",
        type: "activity.create",
        version: 1,
        name: "Private matched task",
        config: {
          subject: { kind: "value", value: "Private task subject" },
          dealId: { kind: "reference", nodeId: "read", path: ["id"] },
        },
      },
      {
        id: "wait",
        type: "delay",
        version: 1,
        name: "Private wait",
        config: { minutes: { kind: "value", value: 17 } },
      },
      {
        id: "after_wait",
        type: "activity.create",
        version: 1,
        name: "Private delayed task",
        config: { subject: { kind: "value", value: "Private delayed subject" } },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "check", port: "next" },
      { from: "check", to: "matched", port: "true" },
      { from: "check", to: "wait", port: "false" },
      { from: "wait", to: "after_wait", port: "next" },
    ],
    layout: { start: { x: 321, y: -123 } },
  };
}

function node(definition: WorkflowDefinition, id: string): WorkflowNode {
  const found = definition.nodes.find((entry) => entry.id === id);
  if (found === undefined) throw new Error("Missing live-review fixture node");
  return found;
}

const configured = {
  configuredSteps: 6,
  counts: { start: 1, read: 1, task: 2, condition: 1, delay: 1 },
};

describe("live run configured-effect projection", () => {
  it("counts both configured branches without claiming either execution path", () => {
    expect(projectLiveRunEffects(sample())).toEqual(configured);
  });

  it("returns only fixed count keys while omitting authored names, values and identities", () => {
    const input = sample();
    node(input, "matched").config.customFields = {
      [customFieldId]: { kind: "value", value: "Private custom field value" },
    };
    const output = projectLiveRunEffects(input);
    expect(output).toEqual(configured);
    const serialized = JSON.stringify(output);
    for (const omitted of [
      "Private",
      "recordId",
      "nodeId",
      "matched",
      "after_wait",
      "subject",
      "customFields",
      customFieldId,
      "layout",
      "321",
      "-123",
    ])
      expect(serialized).not.toContain(omitted);
  });

  it("accepts structurally supported task custom values without claiming current metadata checks", () => {
    const input = sample();
    node(input, "matched").config.customFields = {
      [customFieldId]: {
        kind: "value",
        value: { street: "Private road", city: "Private town", lat: 52.5, lng: 13.4 },
      },
    };
    expect(projectLiveRunEffects(input)).toEqual(configured);
  });

  it("supports a task custom reference while omitting its field and binding identity", () => {
    const input = sample();
    node(input, "matched").config.customFields = {
      [customFieldId]: { kind: "reference", nodeId: "read", path: ["ownerId"] },
    };
    expect(projectLiveRunEffects(input)).toEqual(configured);
  });

  it("keeps counts independent of authored text, node order and layout", () => {
    const input = sample();
    for (const entry of input.nodes) entry.name = "نام خصوصی";
    node(input, "matched").config.subject = { kind: "value", value: "Anderer privater Titel" };
    node(input, "wait").config.minutes = { kind: "value", value: 43 };
    input.nodes.reverse();
    input.edges.reverse();
    input.layout = { read: { x: -99999, y: 99999 } };
    expect(projectLiveRunEffects(input)).toEqual(configured);
  });

  it("leaves the retained definition unchanged", () => {
    const input = sample();
    const before = structuredClone(input);
    expect(projectLiveRunEffects(input)).toEqual(configured);
    expect(input).toEqual(before);
  });

  it("supports a manual publication with no configured downstream effects", () => {
    expect(
      projectLiveRunEffects({
        schemaVersion: 1,
        nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} }],
        edges: [],
      }),
    ).toEqual({
      configuredSteps: 1,
      counts: { start: 1, read: 0, task: 0, condition: 0, delay: 0 },
    });
  });

  const unsupported: { name: string; mutate: (input: WorkflowDefinition) => void }[] = [
    {
      name: "record trigger handler",
      mutate: (input) => {
        Object.assign(node(input, "start"), {
          type: "trigger.record",
          config: { entity: "deal", event: "updated" },
        });
      },
    },
    {
      name: "notification handler",
      mutate: (input) => {
        Object.assign(node(input, "matched"), {
          type: "notification",
          config: { title: { kind: "value", value: "Private notification" } },
        });
      },
    },
    {
      name: "non-deal read handler",
      mutate: (input) => {
        node(input, "read").config.entity = "person";
      },
    },
    {
      name: "task assignee setting",
      mutate: (input) => {
        node(input, "matched").config.assigneeId = {
          kind: "value",
          value: "bf20af8d-8d20-4b59-a7dc-a4cc707c4248",
        };
      },
    },
  ];
  it.each(unsupported)(
    "does not present an unavailable $name as a runnable effect",
    ({ mutate }) => {
      const input = sample();
      mutate(input);
      expect(projectLiveRunEffects(input)).toBeNull();
    },
  );

  const invalid: { name: string; mutate: (input: WorkflowDefinition) => void }[] = [
    {
      name: "duplicate node identity",
      mutate: (input) => {
        node(input, "after_wait").id = "matched";
      },
    },
    {
      name: "dangling connection",
      mutate: (input) => {
        input.edges.push({ from: "matched", to: "absent", port: "next" });
      },
    },
    {
      name: "unreachable step",
      mutate: (input) => {
        input.edges = input.edges.filter((edge) => edge.to !== "after_wait");
      },
    },
    {
      name: "incomplete conditional branch",
      mutate: (input) => {
        input.edges = input.edges.filter((edge) => edge.port !== "false");
      },
    },
    {
      name: "cycle",
      mutate: (input) => {
        input.edges.push({ from: "after_wait", to: "start", port: "next" });
      },
    },
    {
      name: "reference to a later step",
      mutate: (input) => {
        node(input, "read").config.recordId = {
          kind: "reference",
          nodeId: "matched",
          path: ["id"],
        };
      },
    },
    {
      name: "unknown referenced output",
      mutate: (input) => {
        node(input, "matched").config.dealId = {
          kind: "reference",
          nodeId: "read",
          path: ["privateUnknownOutput"],
        };
      },
    },
    {
      name: "malformed task configuration",
      mutate: (input) => {
        node(input, "matched").config.subject = { kind: "value", value: "   " };
      },
    },
    {
      name: "invalid literal wait duration",
      mutate: (input) => {
        node(input, "wait").config.minutes = { kind: "value", value: 0 };
      },
    },
    {
      name: "unknown configuration field",
      mutate: (input) => {
        node(input, "matched").config.privateUnknownSetting = "hidden";
      },
    },
  ];
  it.each(invalid)("returns unavailable for $name", ({ mutate }) => {
    const input = sample();
    mutate(input);
    expect(projectLiveRunEffects(input)).toBeNull();
  });

  it.each([null, undefined, false, 1, "Private malformed definition", []])(
    "rejects a malformed retained publication %#",
    (input) => {
      expect(projectLiveRunEffects(input)).toBeNull();
    },
  );

  it("rejects unknown root fields and unsupported schema or node versions", () => {
    const input = sample();
    expect(projectLiveRunEffects({ ...input, privateUnknownField: "hidden" })).toBeNull();
    expect(projectLiveRunEffects({ ...input, schemaVersion: 2 })).toBeNull();
    Object.assign(node(input, "read"), { version: 2 });
    expect(projectLiveRunEffects(input)).toBeNull();
  });

  it("rejects excessive graph and connection sizes", () => {
    const input = sample();
    input.nodes = Array.from({ length: 101 }, (_, index) => ({
      id: `node_${index}`,
      type: "trigger.manual",
      version: 1,
      name: "Start",
      config: {},
    }));
    expect(projectLiveRunEffects(input)).toBeNull();
    const excessiveEdges = sample();
    excessiveEdges.edges = Array.from({ length: 201 }, () => ({
      from: "start",
      to: "read",
      port: "next",
    }));
    expect(projectLiveRunEffects(excessiveEdges)).toBeNull();
  });

  it("rejects cyclic JSON before recursive definition parsing", () => {
    const input = sample();
    const cycle: Record<string, unknown> = {};
    cycle.privateLoop = cycle;
    Object.assign(node(input, "matched").config, { privateCycle: cycle });
    expect(projectLiveRunEffects(input)).toBeNull();
  });

  it("rejects excessive JSON depth before recursive definition parsing", () => {
    const input = sample();
    let nested: unknown = "Private deep value";
    for (let depth = 0; depth < 50; depth++) nested = { child: nested };
    Object.assign(node(input, "matched").config, { privateDeepValue: nested });
    expect(projectLiveRunEffects(input)).toBeNull();
  });

  it("bounds total JSON work even for a known custom-field literal shape", () => {
    const input = sample();
    node(input, "matched").config.customFields = {
      [customFieldId]: { kind: "value", value: Array.from({ length: 100_001 }, () => "Private") },
    };
    expect(projectLiveRunEffects(input)).toBeNull();
  });

  it("returns unavailable for a non-JSON scalar without exposing its value", () => {
    const input = sample();
    Object.assign(node(input, "matched").config, { privateValue: Number.POSITIVE_INFINITY });
    expect(projectLiveRunEffects(input)).toBeNull();
  });
});
