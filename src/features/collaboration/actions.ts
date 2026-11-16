"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./actions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./actions.backend";

export async function createNoteAction(
  ...args: Parameters<Implementation["createNoteAction"]>
): ReturnType<Implementation["createNoteAction"]> {
  return invokeAction("features/collaboration/actions.createNoteAction", args);
}

export async function togglePinAction(
  ...args: Parameters<Implementation["togglePinAction"]>
): ReturnType<Implementation["togglePinAction"]> {
  return invokeAction("features/collaboration/actions.togglePinAction", args);
}

export async function updateNoteAction(
  ...args: Parameters<Implementation["updateNoteAction"]>
): ReturnType<Implementation["updateNoteAction"]> {
  return invokeAction("features/collaboration/actions.updateNoteAction", args);
}

export async function deleteNoteAction(
  ...args: Parameters<Implementation["deleteNoteAction"]>
): ReturnType<Implementation["deleteNoteAction"]> {
  return invokeAction("features/collaboration/actions.deleteNoteAction", args);
}
