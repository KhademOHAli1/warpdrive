import type { ReactNode } from "react";
import { SubscribersNavigation } from "@/features/newsletter/audience/SubscribersNavigation";

export default function SubscribersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-5">
      <SubscribersNavigation />
      {children}
    </div>
  );
}
