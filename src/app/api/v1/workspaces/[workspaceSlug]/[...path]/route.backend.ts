import { db } from "@/db/client";
import { projectIntegratorRequest } from "@/features/projects/integrator/runtime";

type Context = { params: Promise<{ workspaceSlug: string; path: string[] }> };

async function handle(request: Request, context: Context) {
  const { workspaceSlug, path } = await context.params;
  return projectIntegratorRequest(db, request, workspaceSlug, path);
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
