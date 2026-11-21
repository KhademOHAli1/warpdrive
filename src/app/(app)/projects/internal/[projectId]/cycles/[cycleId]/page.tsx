import { planningGroupPage } from "@/features/projects/planning/PlanningScreens";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; cycleId: string }>;
}) {
  const { projectId, cycleId } = await params;
  return planningGroupPage(projectId, "cycles", cycleId);
}
