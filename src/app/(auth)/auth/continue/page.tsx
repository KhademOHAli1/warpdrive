import { authPageMetadata } from "@/features/auth/ui/authPageMetadata";
import { ContinueScreen } from "@/features/auth/ui/ContinueScreen";

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string | string[]; returnTo?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <ContinueScreen returnTo={typeof query?.returnTo === "string" ? query.returnTo : undefined} />
  );
}

export function generateMetadata() {
  return authPageMetadata("securityTitle");
}
