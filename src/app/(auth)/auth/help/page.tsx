import { authPageMetadata } from "@/features/auth/ui/authPageMetadata";
import { SignInHelpScreen } from "@/features/auth/ui/SignInHelpScreen";

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <SignInHelpScreen returnTo={typeof query?.returnTo === "string" ? query.returnTo : undefined} />
  );
}

export function generateMetadata() {
  return authPageMetadata("signInHelpTitle");
}
