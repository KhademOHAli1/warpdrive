import { authPageMetadata } from "@/features/auth/ui/authPageMetadata";
import { PasswordFlow } from "@/features/auth/ui/PasswordFlow";

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string | string[]; returnTo?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <PasswordFlow mode="reset" token={typeof query?.token === "string" ? query.token : undefined} />
  );
}

export function generateMetadata() {
  return authPageMetadata("choosePassword");
}
