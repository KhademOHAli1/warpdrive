import { redirect } from "next/navigation";
import { createContext } from "@/server/trpc/context";
import { BrandingClient } from "./BrandingClient";
export default async function BrandingPage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  return <BrandingClient actorId={actor.id} />;
}
