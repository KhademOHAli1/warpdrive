import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Db } from "@/db/client";
import { isDealVisibleToSession } from "@/features/deals/createdVisibility";
import { createDeal, moveDeal, updateDeal } from "@/features/deals/dealActions";
import { dealCreateInput, dealMoveInput, dealUpdateInput } from "@/features/deals/schemas";
import { isLeadVisibleToSession } from "@/features/leads/createdVisibility";
import { archiveLead, createLead } from "@/features/leads/leadActions";
import { convertLead } from "@/features/leads/leadConvert";
import { updateLead } from "@/features/leads/leadUpdate";
import {
  convertLeadInput,
  leadArchiveInput,
  leadCreateInput,
  leadUpdateInput,
} from "@/features/leads/schemas";
import { buildEntityCreateSession, toPermSetUser } from "@/features/mcp/actorContext";
import {
  type GetCtx,
  getToolActor,
  registerTool,
  resultToTool,
  type ToolRegistry,
  toolError,
  toolResult,
} from "./types";

// Transport accepts only the missing legacy field so the domain can return the
// refresh/conflict result. A successful write still requires the UUID; malformed
// present values stay input-invalid and never become timestamp fallbacks.
const updateDealToolInput = z.object({
  ...dealUpdateInput.shape,
  expectedWriteVersion: dealUpdateInput.shape.expectedWriteVersion.optional(),
});
const moveDealToolInput = z.object({
  ...dealMoveInput.shape,
  expectedWriteVersion: dealMoveInput.shape.expectedWriteVersion.optional(),
});

export function registerDealWriteTools(
  server: McpServer,
  registry: ToolRegistry,
  getCtx: GetCtx,
  db: Db,
): void {
  registerTool(server, registry, {
    name: "create_deal",
    description: "Create a deal",
    inputSchema: dealCreateInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      const session = await buildEntityCreateSession(db, actor.value, signal);
      const created = await createDeal(db, session, input, signal);
      if (!created.ok) return resultToTool(created);
      if (!(await isDealVisibleToSession(db, session, created.value.id, signal))) {
        return toolResult({ created: true });
      }
      return resultToTool(created);
    },
  });
  registerTool(server, registry, {
    name: "update_deal",
    description:
      "Update a deal using expectedWriteVersion from the displayed get_deal/list_deals snapshot; refresh after a conflict",
    inputSchema: updateDealToolInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      return resultToTool(await updateDeal(db, toPermSetUser(actor.value), input, signal));
    },
  });
  registerTool(server, registry, {
    name: "move_deal_stage",
    description:
      "Move a deal using expectedWriteVersion from the displayed get_deal/list_deals snapshot; refresh after a conflict",
    inputSchema: moveDealToolInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      return resultToTool(await moveDeal(db, toPermSetUser(actor.value), input, signal));
    },
  });
  registerTool(server, registry, {
    name: "create_lead",
    description: "Create a lead",
    inputSchema: leadCreateInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      const session = await buildEntityCreateSession(db, actor.value, signal);
      const created = await createLead(db, session, input, signal);
      if (!created.ok) return resultToTool(created);
      if (!(await isLeadVisibleToSession(db, session, created.value.id, signal))) {
        return toolResult({ created: true });
      }
      return resultToTool(created);
    },
  });
  registerTool(server, registry, {
    name: "update_lead",
    description: "Update a lead",
    inputSchema: leadUpdateInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      const session = await buildEntityCreateSession(db, actor.value, signal);
      return resultToTool(await updateLead(db, session, input, signal));
    },
  });
  registerTool(server, registry, {
    name: "convert_lead_to_deal",
    description: "Convert a lead to a deal",
    inputSchema: convertLeadInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      const session = await buildEntityCreateSession(db, actor.value, signal);
      const converted = await convertLead(db, session, input, signal);
      if (!converted.ok) return resultToTool(converted);
      if (!(await isDealVisibleToSession(db, session, converted.value.dealId, signal))) {
        return toolResult({ dealId: converted.value.dealId });
      }
      return resultToTool(converted);
    },
  });
  registerTool(server, registry, {
    name: "archive_lead",
    description:
      "Archive a lead out of the inbox, or restore it with archived=false. Use this to retire a lead whose deal already exists, instead of convert_lead_to_deal.",
    inputSchema: leadArchiveInput,
    run: async (input, signal) => {
      const actor = getToolActor(getCtx);
      if (!actor.ok) return toolError(actor.error);
      const session = await buildEntityCreateSession(db, actor.value, signal);
      return resultToTool(await archiveLead(db, session, input, signal));
    },
  });
}
