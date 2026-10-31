import { authPageMetadata } from "@/features/auth/ui/authPageMetadata";
import { InvitationScreen } from "@/features/auth/ui/InvitationScreen";

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string | string[]; returnTo?: string | string[] }>;
}) {
  const query = await searchParams;
  return <InvitationScreen token={typeof query?.token === "string" ? query.token : ""} />;
}

export function generateMetadata() {
  return authPageMetadata("inviteTitle");
}
