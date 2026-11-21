"use client";

import { useRef, useState } from "react";
import {
  blankCatalogProfile,
  type CatalogCategory,
  type CatalogCommand,
  type CatalogPart,
  type CatalogResult,
  type CatalogState,
  type CatalogWorkspace,
  catalogCommand,
} from "../contracts";
import {
  catalogLinkCycle,
  normalizeCatalogParameters,
  validCatalogParameterDefinitions,
} from "../parameters";
import { CatalogWorkspaceView } from "./CatalogWorkspaceView";
import { applicableParameters, categoryTrail, currentState } from "./catalogDisplay";

const demoId = (suffix: number) => `10000000-1111-4111-8111-${String(suffix).padStart(12, "0")}`;
const baseCategory: CatalogCategory = {
  id: demoId(1),
  code: "ELECTRONICS",
  name: "Electronics",
  parentId: null,
  defaultUnit: "each",
  parameters: [{ key: "pitch", label: "Connector pitch", kind: "number", unit: "mm" }],
};
const controllerCategory: CatalogCategory = {
  id: demoId(2),
  code: "CONTROLLERS",
  name: "Controllers",
  parentId: baseCategory.id,
  defaultUnit: null,
  parameters: [{ key: "input_voltage", label: "Input voltage", kind: "number", unit: "V" }],
};
const released: CatalogState = {
  id: demoId(3),
  code: "RELEASED",
  name: "Released",
  active: true,
  locked: true,
};
const retired: CatalogState = {
  id: demoId(4),
  code: "RETIRED",
  name: "Retired",
  active: false,
  locked: true,
};
const categories = [baseCategory, controllerCategory];

const controller: CatalogPart = {
  id: demoId(5),
  familyId: demoId(6),
  code: "PLC-120",
  sku: "PLC-120",
  name: "Compact PLC",
  revision: "A",
  kind: "product",
  onHand: 8,
  reserved: 3,
  profile: {
    ...blankCatalogProfile("product"),
    categoryId: controllerCategory.id,
    stateId: released.id,
    description: "Compact control module for a DIN rail cabinet.",
    tags: ["din-rail", "controller"],
    values: [
      { key: "pitch", value: 2.5, unit: "mm" },
      { key: "input_voltage", value: 24, unit: "V" },
    ],
  },
  parameters: applicableParameters(categories, controllerCategory.id),
  whereUsedByIds: [],
};

export function CatalogFixture({ actorId, canManage }: { actorId: string; canManage: boolean }) {
  const [initial] = useState<CatalogWorkspace>(() => ({
    categories,
    states: [released, retired],
    parts: [controller],
    canManage,
  }));
  const current = useRef(initial);

  function submit(raw: CatalogCommand): Promise<CatalogResult> {
    if (!canManage) return Promise.resolve({ ok: false, error: "unavailable" });
    const parsed = catalogCommand.safeParse(raw);
    if (!parsed.success) return Promise.resolve({ ok: false, error: "invalid" });
    const result = applyFixture(current.current, parsed.data);
    if (result.ok) current.current = result.value;
    return Promise.resolve(result);
  }

  return (
    <CatalogWorkspaceView id={`fixture:${actorId}`} initial={initial} submit={submit} fixture />
  );
}

function store<T extends { id: string }>(rows: T[], item: T) {
  return rows.some((row) => row.id === item.id)
    ? rows.map((row) => (row.id === item.id ? item : row))
    : [...rows, item];
}

function applyFixture(workspace: CatalogWorkspace, command: CatalogCommand): CatalogResult {
  switch (command.type) {
    case "savePart":
      return saveFixturePart(workspace, command);
    case "setPartState": {
      const part = workspace.parts.find(({ id }) => id === command.id);
      if (!part || part.profile.version !== command.version)
        return { ok: false, error: "conflict" };
      const next = {
        ...part,
        profile: { ...part.profile, version: part.profile.version + 1, stateId: command.stateId },
      };
      return {
        ok: true,
        value: { ...workspace, parts: store(workspace.parts, next) },
        focusId: part.id,
      };
    }
    case "saveCategory":
      return saveFixtureCategory(workspace, command);
    case "saveState": {
      const { id, code, name, active, locked } = command;
      if (workspace.states.some((entry) => entry.code === code && entry.id !== id))
        return { ok: false, error: "duplicate" };
      const state = { id: id ?? crypto.randomUUID(), code, name, active, locked };
      return {
        ok: true,
        value: { ...workspace, states: store(workspace.states, state) },
        focusId: state.id,
      };
    }
  }
}

function saveFixtureCategory(
  workspace: CatalogWorkspace,
  {
    id: currentId,
    code,
    name,
    parentId,
    defaultUnit,
    parameters,
  }: Extract<CatalogCommand, { type: "saveCategory" }>,
): CatalogResult {
  const id = currentId ?? crypto.randomUUID();
  if (workspace.categories.some((entry) => entry.code === code && entry.id !== id))
    return { ok: false, error: "duplicate" };
  if (categoryTrail(workspace.categories, parentId).some((entry) => entry.id === id))
    return { ok: false, error: "cycle" };
  if (!validCatalogParameterDefinitions(parameters)) return { ok: false, error: "invalid" };
  const categories = store(workspace.categories, {
    id,
    code,
    name,
    parentId,
    defaultUnit,
    parameters,
  });
  const parts = workspace.parts.map((part) => ({
    ...part,
    parameters: applicableParameters(categories, part.profile.categoryId),
  }));
  return { ok: true, value: { ...workspace, categories, parts }, focusId: id };
}

function saveFixturePart(
  workspace: CatalogWorkspace,
  command: Extract<CatalogCommand, { type: "savePart" }>,
): CatalogResult {
  const { id: currentId, code, name, revision, kind, profile } = command;
  const existing = workspace.parts.find((part) => part.id === currentId);
  if (existing && currentState(workspace, existing)?.locked === true)
    return { ok: false, error: "locked" };
  if (
    workspace.parts.some(
      (part) =>
        part.id !== currentId &&
        part.code === code &&
        part.revision.toUpperCase() === revision.toUpperCase(),
    )
  )
    return { ok: false, error: "duplicate" };
  const id = currentId ?? crypto.randomUUID();
  if (
    catalogLinkCycle(
      id,
      profile.templateItemId,
      (id) => workspace.parts.find((part) => part.id === id)?.profile.templateItemId ?? null,
    )
  )
    return { ok: false, error: "cycle" };
  const parameters = applicableParameters(workspace.categories, profile.categoryId);
  const values = normalizeCatalogParameters(profile.values, parameters);
  if (values === null) return { ok: false, error: "unitMismatch" };
  const family = workspace.parts.find((part) => part.code === code);
  const part: CatalogPart = {
    id,
    code,
    name,
    revision,
    kind,
    parameters,
    familyId: family?.familyId ?? crypto.randomUUID(),
    sku: existing?.sku ?? (family ? `${code}-${revision}` : code),
    onHand: existing?.onHand ?? 0,
    reserved: existing?.reserved ?? 0,
    whereUsedByIds: existing?.whereUsedByIds ?? [],
    profile: {
      ...profile,
      version: profile.version + 1,
      unit:
        profile.unit ??
        categoryTrail(workspace.categories, profile.categoryId)
          .reverse()
          .find((entry) => entry.defaultUnit !== null)?.defaultUnit ??
        "each",
      values,
    },
  };
  return { ok: true, value: { ...workspace, parts: store(workspace.parts, part) }, focusId: id };
}
