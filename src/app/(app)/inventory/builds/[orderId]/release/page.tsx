import { notFound } from "next/navigation";
import { z } from "zod";
import { BuildReleasePage } from "@/features/inventory/releases/ui/BuildReleasePage";
import { readBuildRelease } from "@/features/inventory/releases/webReads";

export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const order = z
    .uuid()
    .toLowerCase()
    .safeParse((await params).orderId);
  if (!order.success) notFound();
  const result = await readBuildRelease(order.data);
  if (!result.ok) notFound();
  return <BuildReleasePage build={result.value} />;
}
