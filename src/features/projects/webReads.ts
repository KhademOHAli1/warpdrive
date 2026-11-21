import { TRPCClientError } from "@trpc/client";
import { redirect } from "next/navigation";
import { createContext } from "@/frontend/context";
import { projectLanding } from "@/frontend/reads";
import { coreClient } from "@/frontend/trpc";
import { err } from "@/types/result";
import type { ProjectResult } from "./contracts";

export async function requireInternalProjects() {
  const context = await createContext();
  if (context.session === null) redirect("/login");
  const landing = await projectLanding();
  if (landing === null) redirect("/login");
  if (!landing.enabled) redirect("/projects");
  return landing;
}

async function read<T>(request: () => Promise<ProjectResult<T>>): Promise<ProjectResult<T>> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof TRPCClientError) return err("project_unavailable");
    throw error;
  }
}

export const readInternalProjects = () => read(() => coreClient().internalProjects.index.query());
export const readInternalWorkspace = (projectId: string) =>
  read(() => coreClient().internalProjects.workspace.query({ projectId }));
