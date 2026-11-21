import { planningViewsPage } from "@/features/projects/planning/PlanningScreens";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ favorites?: string | string[] }>;
}) {
  const [{ projectId }, { favorites }] = await Promise.all([params, searchParams]);
  return planningViewsPage(projectId, favorites === "1");
}
