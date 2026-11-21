import { TRPCClientError } from "@trpc/client";
import { coreClient } from "@/frontend/trpc";
import { err } from "@/types/result";
import type { ProjectResult } from "../contracts";

async function read<T>(query: () => Promise<ProjectResult<T>>): Promise<ProjectResult<T>> {
  try {
    return await query();
  } catch (error) {
    if (error instanceof TRPCClientError) return err("project_unavailable");
    throw error;
  }
}

export const readPublicationSettingsFromCore = (projectId: string) =>
  read(() => coreClient().internalProjects.publication.settings.query({ projectId }));
export const readPublishedBoardFromCore = (anchor: string, page: number) =>
  read(() => coreClient().internalProjects.publication.board.query({ anchor, page }));
export const readPublishedCoverFromCore = (anchor: string, version: string) =>
  read(() => coreClient().internalProjects.publication.cover.query({ anchor, version }));
