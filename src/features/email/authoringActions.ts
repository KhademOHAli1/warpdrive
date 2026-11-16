"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./authoringActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./authoringActions.backend";

export async function createTemplateAction(
  ...args: Parameters<Implementation["createTemplateAction"]>
): ReturnType<Implementation["createTemplateAction"]> {
  return invokeAction("features/email/authoringActions.createTemplateAction", args);
}

export async function createSignatureAction(
  ...args: Parameters<Implementation["createSignatureAction"]>
): ReturnType<Implementation["createSignatureAction"]> {
  return invokeAction("features/email/authoringActions.createSignatureAction", args);
}

export async function setDefaultSignatureAction(
  ...args: Parameters<Implementation["setDefaultSignatureAction"]>
): ReturnType<Implementation["setDefaultSignatureAction"]> {
  return invokeAction("features/email/authoringActions.setDefaultSignatureAction", args);
}

export async function updateTemplateAction(
  ...args: Parameters<Implementation["updateTemplateAction"]>
): ReturnType<Implementation["updateTemplateAction"]> {
  return invokeAction("features/email/authoringActions.updateTemplateAction", args);
}

export async function deleteTemplateAction(
  ...args: Parameters<Implementation["deleteTemplateAction"]>
): ReturnType<Implementation["deleteTemplateAction"]> {
  return invokeAction("features/email/authoringActions.deleteTemplateAction", args);
}

export async function reorderTemplatesAction(
  ...args: Parameters<Implementation["reorderTemplatesAction"]>
): ReturnType<Implementation["reorderTemplatesAction"]> {
  return invokeAction("features/email/authoringActions.reorderTemplatesAction", args);
}

export async function deleteTemplatesAction(
  ...args: Parameters<Implementation["deleteTemplatesAction"]>
): ReturnType<Implementation["deleteTemplatesAction"]> {
  return invokeAction("features/email/authoringActions.deleteTemplatesAction", args);
}

export async function updateSignatureAction(
  ...args: Parameters<Implementation["updateSignatureAction"]>
): ReturnType<Implementation["updateSignatureAction"]> {
  return invokeAction("features/email/authoringActions.updateSignatureAction", args);
}

export async function deleteSignatureAction(
  ...args: Parameters<Implementation["deleteSignatureAction"]>
): ReturnType<Implementation["deleteSignatureAction"]> {
  return invokeAction("features/email/authoringActions.deleteSignatureAction", args);
}
