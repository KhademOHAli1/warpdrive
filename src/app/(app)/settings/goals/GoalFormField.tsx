import type { ReactNode } from "react";

const fieldClasses = {
  form: "min-w-0 space-y-1.5",
  builder: "min-w-0 space-y-2",
  graph: "space-y-1.5",
};

export function GoalFormField({
  label,
  children,
  help,
  variant = "form",
}: {
  label: string;
  children: ReactNode;
  help?: string;
  variant?: keyof typeof fieldClasses;
}) {
  const graph = variant === "graph";
  return (
    <div className={fieldClasses[variant]}>
      <span
        className={
          graph ? "block text-xs font-medium text-muted-foreground" : "block text-sm font-medium"
        }
      >
        {label}
      </span>
      {children}
      {help !== undefined && (graph || help !== "") && (
        <p
          className={
            graph
              ? "text-[11px] leading-relaxed text-muted-foreground"
              : "text-xs leading-relaxed text-muted-foreground"
          }
        >
          {help}
        </p>
      )}
    </div>
  );
}
