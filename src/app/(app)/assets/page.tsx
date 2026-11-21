import { notFound, redirect } from "next/navigation";
import { AssetsFixture } from "@/features/assets/ui/AssetsFixture";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext } from "@/frontend/context";

export default async function AssetsPage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  if (!actor.isActive || !inventoryFixturesEnabled()) notFound();
  return <AssetsFixture key={actor.id} canManage={actor.type === "admin"} />;
}
