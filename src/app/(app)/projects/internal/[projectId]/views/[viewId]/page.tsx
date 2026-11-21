import { planningViewPage } from "@/features/projects/planning/PlanningScreens";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; viewId: string }>;
}) {
  const { projectId, viewId } = await params;
  return planningViewPage(projectId, viewId);
}
