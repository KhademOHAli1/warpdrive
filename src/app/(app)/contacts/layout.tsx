import type { ReactNode } from "react";
import { ContactsNav } from "./ContactsNav";

// A compact section switcher keeps the full width available for contact data and detail views.
export default function ContactsLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="min-w-0 space-y-6">
      <ContactsNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
