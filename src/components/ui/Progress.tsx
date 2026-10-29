"use client";
import { Progress as RadixProgress } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { useDirection } from "./direction";

interface ProgressProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RadixProgress.Root>, "value" | "max"> {
  value: number;
  max?: number;
  label: string;
  indicatorClassName?: string;
}

export const Progress = forwardRef<React.ElementRef<typeof RadixProgress.Root>, ProgressProps>(
  ({ value, max = 100, label, className, indicatorClassName, ...props }, ref) => {
    const direction = useDirection();
    const safeMax = max > 0 ? max : 100;
    const clamped = Math.min(Math.max(value, 0), safeMax);
    const remaining = 100 - (clamped / safeMax) * 100;
    return (
      <RadixProgress.Root
        ref={ref}
        dir={direction}
        data-slot="progress"
        value={clamped}
        max={safeMax}
        aria-label={label}
        className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
        {...props}
      >
        <RadixProgress.Indicator
          className={cn(
            "h-full w-full bg-primary transition-transform duration-300 ease-out motion-reduce:transition-none",
            indicatorClassName,
          )}
          style={{ transform: `translateX(${direction === "rtl" ? remaining : -remaining}%)` }}
        />
      </RadixProgress.Root>
    );
  },
);
Progress.displayName = "Progress";
