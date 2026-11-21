import { TRPCClientError } from "@trpc/client";
import { coreClient } from "@/frontend/trpc";
import { err } from "@/types/result";
import type { ProjectResult } from "../contracts";
import type { ProjectDocumentKey, ReadProjectDocumentVersionInput } from "./contracts";

async function read<T>(request: () => Promise<ProjectResult<T>>): Promise<ProjectResult<T>> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof TRPCClientError) return err("project_unavailable");
    throw error;
  }
}

export const readProjectDocuments = (projectId: string) =>
  read(() => coreClient().projectDocuments.list.query({ projectId }));

export const readProjectDocument = (input: ProjectDocumentKey) =>
  read(() => coreClient().projectDocuments.read.query(input));

export const readProjectDocumentVersion = (input: ReadProjectDocumentVersionInput) =>
  read(() => coreClient().projectDocuments.version.query(input));
