import { McpServer } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { registerTool, ToolRegistry, toolResult } from "./types";

it("publishes read/write and destructive hints for host approval interfaces", () => {
  const server = new McpServer({ name: "metadata-test", version: "1.0.0" });
  const spy = vi.spyOn(server, "registerTool");
  for (const name of ["get_deal", "create_deal", "delete_email_draft"]) {
    registerTool(server, new ToolRegistry(), {
      name,
      description: "Synthetic metadata fixture",
      inputSchema: z.object({}),
      run: () => Promise.resolve(toolResult({ id: "fixture" })),
    });
  }
  expect(spy.mock.calls[0]?.[1]).toMatchObject({
    annotations: { readOnlyHint: true, destructiveHint: false },
  });
  expect(spy.mock.calls[1]?.[1]).toMatchObject({
    annotations: { readOnlyHint: false, destructiveHint: false },
  });
  expect(spy.mock.calls[2]?.[1]).toMatchObject({
    annotations: { readOnlyHint: false, destructiveHint: true },
  });
});

it("returns structured results as well as the text fallback", () => {
  const result = toolResult({ id: "fixture", title: "An example" });
  expect(result.structuredContent).toEqual({ data: { id: "fixture", title: "An example" } });
  expect(result.content).toEqual([{ type: "text", text: '{"id":"fixture","title":"An example"}' }]);
});
