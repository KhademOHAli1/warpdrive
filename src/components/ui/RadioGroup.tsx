"use client";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  RadioGroup as ShadcnRadioGroup,
  RadioGroupItem as ShadcnRadioGroupItem,
} from "./primitives/radio-group";

// Branded radio group (Radix), the design-system replacement for native <input type=radio>.
// Radix brings roving focus + arrow-key navigation for free, which is exactly the part a
// hand-rolled radio drops. Composable: wrap RadioGroupItem next to its label text, or give the
// item an aria-label when it stands alone. Token-styled to match the rest of the UI.
export const RadioGroup = forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ShadcnRadioGroup ref={ref} className={cn("grid gap-2", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";

// Default renders the standard dot (label text sits beside the item). Pass `children` to render
// custom content instead of the dot: e.g. a clip-path chevron stage segment whose whole surface
// is the control. The dot-specific box styling is applied only in the default (childless) case;
// with children the caller owns all visual styling via className.
export const RadioGroupItem = forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, children, ...props }, ref) =>
  children === undefined || children === null ? (
    <ShadcnRadioGroupItem ref={ref} className={className} {...props} />
  ) : (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "transition-[border-color,color,scale] duration-150 ease-out motion-safe:active:not-disabled:scale-[0.96] motion-reduce:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  ),
);
RadioGroupItem.displayName = "RadioGroupItem";
