import { authPageMetadata } from "@/features/auth/ui/authPageMetadata";
import { PasswordFlow } from "@/features/auth/ui/PasswordFlow";
export default function AuthPage() {
  return <PasswordFlow mode="forgot" />;
}

export function generateMetadata() {
  return authPageMetadata("resetTitle");
}
