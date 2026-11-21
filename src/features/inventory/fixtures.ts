import {
  type InventoryCommand,
  type InventoryItem,
  type InventoryOrder,
  type InventoryResult,
  type InventoryWorkspace,
  inventoryCommand,
} from "./contracts";

const product = "d0777640-5b68-4689-94e6-85d059706521";
const pcb = "e0777640-5b68-4689-94e6-85d059706522";
const enclosure = "f0777640-5b68-4689-94e6-85d059706523";
const label = "f0777640-5b68-4689-94e6-85d059706524";
const projectId = "f0777640-5b68-4689-94e6-85d059706525";
const planner = "f0777640-5b68-4689-94e6-85d059706526";
const assembler = "f0777640-5b68-4689-94e6-85d059706527";
const quality = "f0777640-5b68-4689-94e6-85d059706528";

function fixtureComponent(id: string, sku: string, name: string, onHand: number): InventoryItem {
  return {
    id,
    sku,
    name,
    onHand,
    revision: "A",
    kind: "component",
    reserved: 0,
    bom: [],
    template: null,
  };
}

export function inventoryFixture(dealId: string | undefined): InventoryWorkspace {
  const bom = [pcb, enclosure, label].map((itemId) => ({ itemId, quantity: 1 }));
  return {
    items: [
      {
        id: product,
        sku: "IO-24-DIN",
        name: "DIN-rail I/O module",
        revision: "A",
        kind: "product",
        onHand: 4,
        reserved: 0,
        bom,
        template: {
          projectId,
          steps: [
            { title: "Stage components", assigneeId: planner },
            { title: "Assemble and flash module", assigneeId: assembler },
            { title: "Run electrical and functional tests", assigneeId: quality },
          ],
        },
      },
      fixtureComponent(pcb, "PCB-IO-24", "Populated controller PCB", 18),
      fixtureComponent(enclosure, "ENC-DIN-01", "DIN-rail enclosure", 12),
      fixtureComponent(label, "LBL-IO-24", "I/O module nameplate", 30),
    ],
    orders: [],
    projects: [
      {
        id: projectId,
        title: "I/O module production",
        members: [
          { id: planner, name: "Lena Weber" },
          { id: assembler, name: "Jonas Berger" },
          { id: quality, name: "Mira Hoffmann" },
        ],
      },
    ],
    deal: dealId ? { id: dealId, name: "Demo customer inquiry" } : null,
    canManage: true,
    canOrder: Boolean(dealId),
    fixture: true,
  };
}

function fixtureOrder(
  dealId: string,
  itemId: string,
  quantity: number,
  workspace: InventoryWorkspace,
): InventoryOrder | string {
  const item = workspace.items.find((row) => row.id === itemId);
  if (item?.kind !== "product") return "Select a sellable product.";
  if (workspace.deal?.id !== dealId) return "Open Inventory from a demo deal.";
  const reserved = Math.min(quantity, item.onHand - item.reserved);
  const buildQuantity = quantity - reserved;
  if (buildQuantity > 0 && (!item.template || item.bom.length === 0)) {
    return "Configure a BOM and production template before accepting a shortage.";
  }
  item.reserved += reserved;
  const template = buildQuantity > 0 ? item.template : null;
  return {
    id: crypto.randomUUID(),
    dealId,
    itemId,
    quantity,
    reserved,
    buildQuantity,
    status: buildQuantity ? "awaiting_materials" : "ready",
    revision: 1,
    projectId: template?.projectId ?? null,
    tasks:
      template?.steps.map(({ title }) => ({ id: crypto.randomUUID(), title, done: false })) ?? [],
    materials: buildQuantity
      ? item.bom.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity * buildQuantity,
        }))
      : [],
  };
}

export function applyInventoryFixture(
  current: InventoryWorkspace,
  submitted: InventoryCommand,
): InventoryResult {
  const parsed = inventoryCommand.safeParse(submitted);
  if (!parsed.success)
    return { ok: false, error: "Check the stock, quantity and required fields." };
  const command = parsed.data;
  const value = structuredClone(current);
  if (command.type === "createItem") {
    const { requestId, sku, name, revision, kind, bom } = command;
    if (value.items.some((row) => row.sku === sku))
      return { ok: false, error: "This SKU already exists." };
    if (
      new Set(bom.map((line) => line.itemId)).size !== bom.length ||
      bom.some(
        (line) => !value.items.some((item) => item.id === line.itemId && item.kind === "component"),
      ) ||
      (kind === "component" && bom.length > 0)
    ) {
      return { ok: false, error: "Use distinct component SKUs in the BOM." };
    }
    value.items.push({
      id: requestId,
      sku,
      name,
      revision,
      kind,
      bom,
      onHand: 0,
      reserved: 0,
      template: null,
    });
    return { ok: true, value };
  }
  if (command.type === "receive" || command.type === "saveTemplate") {
    const item = value.items.find((row) => row.id === command.itemId);
    if (!item) return { ok: false, error: "Item could not be found." };
    if (command.type === "receive") item.onHand += command.quantity;
    else {
      const project = value.projects.find((row) => row.id === command.projectId);
      if (
        item.kind !== "product" ||
        !project ||
        command.steps.some(
          (step) => !project.members.some((member) => member.id === step.assigneeId),
        )
      ) {
        return { ok: false, error: "Select a production project and valid members." };
      }
      item.template = { projectId: project.id, steps: command.steps };
    }
    return { ok: true, value };
  }
  if (command.type === "place") {
    const result = fixtureOrder(command.dealId, command.itemId, command.quantity, value);
    if (typeof result === "string") return { ok: false, error: result };
    value.orders.unshift(result);
    return { ok: true, value };
  }
  return applyFixtureOrderChange(value, command);
}

function applyFixtureOrderChange(
  value: InventoryWorkspace,
  command: Extract<InventoryCommand, { orderId: string }>,
): InventoryResult {
  const denied = {
    ok: false,
    error: "This order changed. Open the latest order and try again.",
  } as const;
  const order = value.orders.find((row) => row.id === command.orderId);
  if (!order || order.revision !== command.revision) return denied;
  const item = value.items.find(({ id }) => id === order.itemId);
  if (!item) return denied;
  if (command.type === "reserveMaterials" && order.status === "awaiting_materials") {
    for (const line of order.materials) {
      const material = value.items.find(({ id }) => id === line.itemId);
      if (!material || material.onHand - material.reserved < line.quantity) {
        return { ok: false, error: "There is insufficient stock to reserve all materials." };
      }
      material.reserved += line.quantity;
    }
    order.status = "in_production";
  } else if (command.type === "completeBuild" && order.status === "in_production") {
    // The fixture can post without opening a live project. Core checks native task states.
    for (const line of order.materials) {
      const material = value.items.find(({ id }) => id === line.itemId);
      if (!material) return denied;
      material.onHand -= line.quantity;
      material.reserved -= line.quantity;
    }
    item.onHand += order.buildQuantity;
    item.reserved += order.buildQuantity;
    order.reserved += order.buildQuantity;
    for (const task of order.tasks) task.done = true;
    order.status = "ready";
  } else if (command.type === "ship" && order.status === "ready") {
    item.onHand -= order.reserved;
    item.reserved -= order.reserved;
    order.reserved = 0;
    order.status = "shipped";
  } else if (
    command.type === "cancel" &&
    ["awaiting_materials", "in_production", "ready"].includes(order.status)
  ) {
    item.reserved -= order.reserved;
    order.reserved = 0;
    if (order.status === "in_production") {
      for (const line of order.materials) {
        const material = value.items.find(({ id }) => id === line.itemId);
        if (!material) return denied;
        material.reserved -= line.quantity;
      }
    }
    order.status = "cancelled";
  } else {
    return denied;
  }
  order.revision++;
  return { ok: true, value };
}
