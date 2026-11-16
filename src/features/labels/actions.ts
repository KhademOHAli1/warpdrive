"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function createLabelAction(
  ...args: Parameters<Implementation["createLabelAction"]>
): ReturnType<Implementation["createLabelAction"]> {
  return invokeAction("features/labels/actions.createLabelAction", args);
}

export async function renameLabelAction(
  ...args: Parameters<Implementation["renameLabelAction"]>
): ReturnType<Implementation["renameLabelAction"]> {
  return invokeAction("features/labels/actions.renameLabelAction", args);
}

export async function setLabelColorAction(
  ...args: Parameters<Implementation["setLabelColorAction"]>
): ReturnType<Implementation["setLabelColorAction"]> {
  return invokeAction("features/labels/actions.setLabelColorAction", args);
}

export async function reorderLabelsAction(
  ...args: Parameters<Implementation["reorderLabelsAction"]>
): ReturnType<Implementation["reorderLabelsAction"]> {
  return invokeAction("features/labels/actions.reorderLabelsAction", args);
}

export async function deleteLabelAction(
  ...args: Parameters<Implementation["deleteLabelAction"]>
): ReturnType<Implementation["deleteLabelAction"]> {
  return invokeAction("features/labels/actions.deleteLabelAction", args);
}
