import { describe, expect, it } from "vitest";
import { runWorkflowCode } from "./codeSandbox";

const signal = () => AbortSignal.timeout(6000);
describe("isolated workflow code", () => {
  it("executes typed pure async main without host capabilities", async () => {
    const result = await runWorkflowCode(
      {
        sourceCode:
          "export async function main(input: {a:number}) { return {total: input.a * 3, host: [typeof process,typeof Bun,typeof fetch,typeof require]}; }",
        inputs: { a: 4 },
      },
      signal(),
    );
    expect(result).toEqual({
      ok: true,
      value: { total: 12, host: ["undefined", "undefined", "undefined", "undefined"] },
    });
  });
  it("bounds infinite execution and rejects non JSON/schema outputs", async () => {
    expect(
      (
        await runWorkflowCode(
          { sourceCode: "function main() { while(true) {} }", inputs: {} },
          signal(),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await runWorkflowCode(
          {
            sourceCode: "function main() { return {a: 4}; }",
            inputs: {},
            outputSchema: {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string" } },
            },
          },
          signal(),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await runWorkflowCode(
          { sourceCode: "function main() { return 1n; }", inputs: {} },
          signal(),
        )
      ).ok,
    ).toBe(false);
  });
  it("does not admit modules and caps heap allocation", async () => {
    expect(
      (
        await runWorkflowCode(
          {
            sourceCode:
              'import fs from "node:fs"; function main() { return fs.readFileSync("/etc/passwd"); }',
            inputs: {},
          },
          signal(),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await runWorkflowCode(
          {
            sourceCode:
              'function main() { const a=[]; for(;;) a.push(new Array(10000).fill("x")); }',
            inputs: {},
          },
          signal(),
        )
      ).ok,
    ).toBe(false);
  });
});
