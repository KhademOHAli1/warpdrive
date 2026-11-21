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
    deal: dealId === undefined ? null : { id: dealId, name: "Demo customer inquiry" },
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

type CreateFixtureItem = Extract<InventoryCommand, { type: "createItem" }>;
type SaveFixtureTemplate = Extract<InventoryCommand, { type: "saveTemplate" }>;
type FixtureOrderCommand = Extract<InventoryCommand, { orderId: string }>;

function createFixtureItem(
  workspace: InventoryWorkspace,
  command: CreateFixtureItem,
): string | null {
  const { requestId, sku, name, revision, kind, bom } = command;
  if (workspace.items.some((row) => row.sku === sku)) return "This SKU already exists.";
  const components = new Set(
    workspace.items.filter(({ kind }) => kind === "component").map(({ id }) => id),
  );
  if (
    new Set(bom.map(({ itemId }) => itemId)).size !== bom.length ||
    bom.some(({ itemId }) => !components.has(itemId)) ||
    (kind === "component" && bom.length > 0)
  ) {
    return "Use distinct component SKUs in the BOM.";
  }
  workspace.items.push({
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
  return null;
}

function saveFixtureTemplate(
  workspace: InventoryWorkspace,
  item: InventoryItem,
  command: SaveFixtureTemplate,
): string | null {
  const project = workspace.projects.find((row) => row.id === command.projectId);
  if (
    item.kind !== "product" ||
    !project ||
    command.steps.some(({ assigneeId }) => !project.members.some(({ id }) => id === assigneeId))
  ) {
    return "Select a production project and valid members.";
  }
  item.template = { projectId: project.id, steps: command.steps };
  return null;
}

const invalidFixtureOrder = "This order changed. Open the latest order and try again.";

function postFixtureMaterials(
  workspace: InventoryWorkspace,
  order: InventoryOrder,
  operation: "reserve" | "consume" | "release",
): string | null {
  for (const line of order.materials) {
    const component = workspace.items.find(({ id }) => id === line.itemId);
    if (!component) return invalidFixtureOrder;
    if (operation === "reserve") {
      if (component.onHand - component.reserved < line.quantity)
        return "There is insufficient stock to reserve all materials.";
      component.reserved += line.quantity;
    } else {
      component.reserved -= line.quantity;
      if (operation === "consume") component.onHand -= line.quantity;
    }
  }
  return null;
}

function changeFixtureOrder(
  workspace: InventoryWorkspace,
  command: FixtureOrderCommand,
): string | null {
  const order = workspace.orders.find(({ id }) => id === command.orderId);
  if (!order || order.revision !== command.revision) return invalidFixtureOrder;
  const item = workspace.items.find(({ id }) => id === order.itemId);
  if (!item) return invalidFixtureOrder;
  const error = postFixtureOrderChange(workspace, order, item, command.type);
  if (error === null) order.revision++;
  return error;
}

function postFixtureOrderChange(
  workspace: InventoryWorkspace,
  order: InventoryOrder,
  item: InventoryItem,
  type: FixtureOrderCommand["type"],
): string | null {
  switch (type) {
    case "reserveMaterials": {
      if (order.status !== "awaiting_materials") return invalidFixtureOrder;
      const error = postFixtureMaterials(workspace, order, "reserve");
      if (error !== null) return error;
      order.status = "in_production";
      return null;
    }
    case "completeBuild": {
      if (order.status !== "in_production") return invalidFixtureOrder;
      const error = postFixtureMaterials(workspace, order, "consume");
      if (error !== null) return error;
      // The fixture can post without opening a live project. Core checks native task states.
      item.onHand += order.buildQuantity;
      item.reserved += order.buildQuantity;
      order.reserved += order.buildQuantity;
      for (const task of order.tasks) task.done = true;
      order.status = "ready";
      return null;
    }
    case "ship":
      if (order.status !== "ready") return invalidFixtureOrder;
      item.onHand -= order.reserved;
      item.reserved -= order.reserved;
      order.reserved = 0;
      order.status = "shipped";
      return null;
    case "cancel":
      return cancelFixtureOrder(workspace, order, item);
  }
}

function cancelFixtureOrder(
  workspace: InventoryWorkspace,
  order: InventoryOrder,
  item: InventoryItem,
): string | null {
  if (order.status === "cancelled" || order.status === "shipped") return invalidFixtureOrder;
  if (order.status === "in_production") {
    const error = postFixtureMaterials(workspace, order, "release");
    if (error !== null) return error;
  }
  item.reserved -= order.reserved;
  order.reserved = 0;
  order.status = "cancelled";
  return null;
}

function applyFixtureCommand(
  workspace: InventoryWorkspace,
  command: InventoryCommand,
): string | null {
  if (command.type === "createItem") return createFixtureItem(workspace, command);
  if (command.type === "place") {
    const order = fixtureOrder(command.dealId, command.itemId, command.quantity, workspace);
    if (typeof order === "string") return order;
    workspace.orders.unshift(order);
    return null;
  }
  if ("orderId" in command) return changeFixtureOrder(workspace, command);
  const item = workspace.items.find(({ id }) => id === command.itemId);
  if (!item) return "Item could not be found.";
  if (command.type === "saveTemplate") return saveFixtureTemplate(workspace, item, command);
  item.onHand += command.quantity;
  return null;
}

export function applyInventoryFixture(
  current: InventoryWorkspace,
  submitted: InventoryCommand,
): InventoryResult {
  const parsed = inventoryCommand.safeParse(submitted);
  if (!parsed.success)
    return { ok: false, error: "Check the stock, quantity and required fields." };
  const value = structuredClone(current);
  const error = applyFixtureCommand(value, parsed.data);
  return error === null ? { ok: true, value } : { ok: false, error };
}
