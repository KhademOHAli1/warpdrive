import type { ReactNode } from "react";

export function GoalFormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
