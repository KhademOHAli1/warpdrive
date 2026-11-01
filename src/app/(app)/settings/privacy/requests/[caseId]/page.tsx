import { notFound } from "next/navigation";
import { z } from "zod";
import { PersonalPrivacyWorkspace } from "@/features/privacy/ui/PersonalPrivacyWorkspace";

export { generateMetadata } from "../../page";

const selectorSchema = z.uuid();

export default async function PrivacyCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const selector = selectorSchema.safeParse((await params).caseId);
  if (!selector.success) notFound();
  return <PersonalPrivacyWorkspace caseId={selector.data} />;
}
