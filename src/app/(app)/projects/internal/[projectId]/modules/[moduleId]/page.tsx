import { planningGroupPage } from "@/features/projects/planning/PlanningScreens";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  return planningGroupPage(projectId, "modules", moduleId);
}
