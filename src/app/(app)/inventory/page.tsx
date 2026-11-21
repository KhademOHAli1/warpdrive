import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { inventoryFixture } from "@/features/inventory/fixtures";
import { InventoryFixture } from "@/features/inventory/InventoryFixture";
import { createContext } from "@/frontend/context";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ dealId?: string | string[] }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  const { dealId } = await searchParams;
  if (!inventoryFixturesEnabled()) notFound();
  const parsed = z.uuid().safeParse(dealId);
  return (
    <InventoryFixture key={parsed.data ?? "catalog"} initial={inventoryFixture(parsed.data)} />
  );
}
