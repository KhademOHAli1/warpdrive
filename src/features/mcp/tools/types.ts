import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { HydratedActor } from "@/server/hydrateActor";
import type { AppContext } from "@/server/trpc/context";
import { err, ok, type Result } from "@/types/result";

export type ToolCtx = AppContext;
export type GetCtx = () => ToolCtx;

type Invoke = (input: unknown, signal: AbortSignal) => Promise<CallToolResult>;

export class ToolRegistry {
  readonly names = new Set<string>();
  private readonly handlers = new Map<string, Invoke>();

  add(name: string, handler: Invoke): void {
    this.names.add(name);
    this.handlers.set(name, handler);
  }

  async invoke(name: string, input: unknown): Promise<CallToolResult> {
    const handler = this.handlers.get(name);
    if (handler === undefined) return toolError(`Unknown tool: ${name}`);
    return handler(input, AbortSignal.timeout(10_000));
  }
}

export function toolResult(value: unknown): CallToolResult {
  // Keep the text fallback for older hosts, and expose the same JSON-safe data to app views.
  const data: unknown = value === undefined ? null : JSON.parse(JSON.stringify(value));
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { data } };
}

export function toolError(error: unknown): CallToolResult {
  let text = "Tool execution failed";
  if (error instanceof AppError) text = `${error.id}: ${error.message}`;
  else if (error instanceof TRPCError) {
    text =
      error.cause instanceof AppError ? `${error.cause.id}: ${error.cause.message}` : error.message;
  } else if (error instanceof z.ZodError) text = `Invalid tool input: ${error.message}`;
  return { isError: true, content: [{ type: "text", text }] };
}

export function resultToTool<T>(result: Result<T, AppError>): CallToolResult {
  return result.ok ? toolResult(result.value) : toolError(result.error);
}

export function getToolActor(getCtx: GetCtx): Result<HydratedActor, AppError> {
  const actor = getCtx().actor;
  if (actor !== null) return ok(actor);
  return err(new AppError(ERROR_IDS.OAUTH_TOKEN_REVOKED, "MCP actor is unavailable", {}));
}

export function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  registry: ToolRegistry,
  definition: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<Shape>;
    run: (input: z.output<z.ZodObject<Shape>>, signal: AbortSignal) => Promise<CallToolResult>;
  },
): void {
  const invoke: Invoke = async (raw, signal) => {
    const parsed = definition.inputSchema.safeParse(raw);
    if (!parsed.success) return toolError(parsed.error);
    try {
      return await definition.run(parsed.data, signal);
    } catch (error) {
      return toolError(error);
    }
  };

  server.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: z.object({ data: z.unknown() }),
      annotations: {
        readOnlyHint: /^(?:search|list_|get_|pipeline_summary)/.test(definition.name),
        destructiveHint:
          definition.name === "delete_email_draft" || definition.name === "archive_lead",
        idempotentHint: /^(?:search|list_|get_|pipeline_summary)/.test(definition.name),
        openWorldHint: false,
      },
    },
    (input, ctx) =>
      invoke(input, AbortSignal.any([ctx.mcpReq.signal, AbortSignal.timeout(15_000)])),
  );
  registry.add(definition.name, invoke);
}
