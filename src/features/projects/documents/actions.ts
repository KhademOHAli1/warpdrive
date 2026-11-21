"use server";

import { invokeAction } from "@/frontend/actions";
import type { ProjectResult } from "../contracts";
import type { ProjectDocumentDetail } from "./contracts";

export async function createProjectDocumentAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectDocumentDetail>> {
  return invokeAction("features/projects/documents/actions.createProjectDocumentAction", [
    expectedActorId,
    raw,
    csrfToken,
  ]);
}

export async function saveProjectDocumentAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectDocumentDetail>> {
  return invokeAction("features/projects/documents/actions.saveProjectDocumentAction", [
    expectedActorId,
    raw,
    csrfToken,
  ]);
}

export async function setProjectDocumentLifecycleAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectDocumentDetail>> {
  return invokeAction("features/projects/documents/actions.setProjectDocumentLifecycleAction", [
    expectedActorId,
    raw,
    csrfToken,
  ]);
}

export async function restoreProjectDocumentVersionAction(
  expectedActorId: string,
  raw: unknown,
  csrfToken: string | null,
): Promise<ProjectResult<ProjectDocumentDetail>> {
  return invokeAction("features/projects/documents/actions.restoreProjectDocumentVersionAction", [
    expectedActorId,
    raw,
    csrfToken,
  ]);
}
