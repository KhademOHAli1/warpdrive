import { TRPCClientError } from "@trpc/client";
import { coreClient } from "@/frontend/trpc";
import { err } from "@/types/result";
import type { ProjectResult } from "../contracts";
import type { ProfileItemsInput, ProfileView } from "./contracts";

async function read<T>(request: () => Promise<ProjectResult<T>>): Promise<ProjectResult<T>> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof TRPCClientError) return err("project_unavailable");
    throw error;
  }
}

export const readProfileSummary = () =>
  read(() => coreClient().internalProjects.profile.summary.query());

export const readProfileItems = (view: ProfileView, input: ProfileItemsInput) =>
  read(() => coreClient().internalProjects.profile[view].query(input));
