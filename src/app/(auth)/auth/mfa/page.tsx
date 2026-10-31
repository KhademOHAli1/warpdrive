import { authPageMetadata } from "@/features/auth/ui/authPageMetadata";
import { MfaScreen } from "@/features/auth/ui/ContinueScreen";
export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const query = await searchParams;
  return <MfaScreen returnTo={typeof query?.returnTo === "string" ? query.returnTo : undefined} />;
}

export function generateMetadata() {
  return authPageMetadata("mfaTitle");
}
