import { redirect } from "next/navigation";
import { ProjectsScreen } from "@/features/agency-projects/ProjectsScreen";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { createContext } from "@/frontend/context";
import { projectLanding } from "@/frontend/reads";

export default async function ProjectsPage() {
  const context = await createContext();
  if (context.session === null) redirect("/login");
  const landing = await projectLanding();
  if (landing === null) redirect("/login");
  return (
    <div className="space-y-4">
      {landing.enabled && <ProjectTypeNav active="client" />}
      <ProjectsScreen {...landing} />
    </div>
  );
}
