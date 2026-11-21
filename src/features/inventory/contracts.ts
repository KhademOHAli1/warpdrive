import { z } from "zod";

const id = z.uuid().toLowerCase();
const quantity = z.number().int().positive().max(1_000_000);
const bomLine = z.object({ itemId: id, quantity });
const templateStep = z.object({ title: z.string().trim().min(1).max(100), assigneeId: id });
const orderChange = { requestId: id, orderId: id, revision: z.number().int().positive() };

export const inventoryCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createItem"),
    requestId: id,
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/),
    name: z.string().trim().min(1).max(120),
    revision: z.string().trim().min(1).max(20),
    kind: z.enum(["component", "product"]),
    bom: z.array(bomLine).max(30),
  }),
  z.object({ type: z.literal("receive"), requestId: id, itemId: id, quantity }),
  z.object({
    type: z.literal("saveTemplate"),
    requestId: id,
    itemId: id,
    projectId: id,
    steps: z.array(templateStep).min(1).max(10),
  }),
  z.object({ type: z.literal("place"), requestId: id, dealId: id, itemId: id, quantity }),
  z.object({ type: z.literal("reserveMaterials"), ...orderChange }),
  z.object({ type: z.literal("completeBuild"), ...orderChange }),
  z.object({ type: z.literal("ship"), ...orderChange }),
  z.object({ type: z.literal("cancel"), ...orderChange }),
]);

export type InventoryCommand = z.infer<typeof inventoryCommand>;
export type InventoryBomLine = z.infer<typeof bomLine>;
export type InventoryTemplate = { projectId: string; steps: z.infer<typeof templateStep>[] };
export type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  revision: string;
  kind: "component" | "product";
  onHand: number;
  reserved: number;
  bom: InventoryBomLine[];
  template: InventoryTemplate | null;
  releaseAccess?: boolean;
  partCode?: string;
  canSell?: boolean;
  canReceive?: boolean;
  canUseAsComponent?: boolean;
};

export type InventoryProject = {
  id: string;
  title: string;
  members: { id: string; name: string }[];
};
export type InventoryOrder = {
  id: string;
  dealId: string | null;
  itemId: string;
  quantity: number;
  reserved: number;
  buildQuantity: number;
  status: "awaiting_materials" | "in_production" | "ready" | "shipped" | "cancelled";
  revision: number;
  projectId: string | null;
  tasks: { id: string; title: string; done: boolean }[];
  materials: InventoryBomLine[];
  release?: { revision: string } | null;
};
export type InventoryWorkspace = {
  items: InventoryItem[];
  orders: InventoryOrder[];
  projects: InventoryProject[];
  deal: { id: string; name: string } | null;
  canManage: boolean;
  canOrder: boolean;
  fixture: boolean;
};
export type InventoryResult =
  | { ok: true; value: InventoryWorkspace }
  | { ok: false; error: string };
