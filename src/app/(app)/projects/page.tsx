import { redirect } from "next/navigation";
import { ProjectsScreen } from "@/features/agency-projects/ProjectsScreen";
import { createContext } from "@/frontend/context";
import { projectLanding } from "@/frontend/reads";

export default async function ProjectsPage() {
  const context = await createContext();
  if (context.session === null) redirect("/login");
  const landing = await projectLanding();
  if (landing === null) redirect("/login");
  return <ProjectsScreen {...landing} />;
}
