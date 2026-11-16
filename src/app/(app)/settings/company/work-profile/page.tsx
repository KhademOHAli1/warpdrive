import { redirect } from "next/navigation";
import { createContext } from "@/frontend/context";
import { WorkProfileClient } from "./WorkProfileClient";
export default async function WorkProfilePage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  return <WorkProfileClient actorId={actor.id} />;
}
