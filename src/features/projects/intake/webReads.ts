import { TRPCClientError } from "@trpc/client";
import { coreClient } from "@/frontend/trpc";
import { err } from "@/types/result";
import type { ReadIntakeWorkspaceInput } from "./input";

export async function readProjectIntakeWorkspace(input: ReadIntakeWorkspaceInput) {
  try {
    return await coreClient().internalProjects.intake.workspace.query(input);
  } catch (error) {
    if (error instanceof TRPCClientError) return err("project_unavailable" as const);
    throw error;
  }
}
