"use client";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { useDirection } from "./direction";
import * as AlertDialogPrimitive from "./primitives/alert-dialog";

// shadcn Radix Nova AlertDialog wrapper over @radix-ui/react-alert-dialog. The SANCTIONED primitive
// for a destructive confirmation: unlike Dialog it uses role="alertdialog", does not dismiss on
// outside-click, and focuses the Cancel action, so a stray click cannot confirm. Escape still
// dismisses (verified in-browser), which is safe: it lands on Cancel, never on the action.
// See CLAUDE.md "Use the design system, never reinvent".
export const AlertDialog = AlertDialogPrimitive.AlertDialog;
export const AlertDialogTrigger = AlertDialogPrimitive.AlertDialogTrigger;

export const AlertDialogContent = forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.AlertDialogContent>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.AlertDialogContent>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.AlertDialogContent
    ref={ref}
    dir={useDirection()}
    className={cn(
      "w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg sm:max-w-lg",
      className,
    )}
    {...props}
  />
));
AlertDialogContent.displayName = "AlertDialogContent";

export function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 text-start", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export const AlertDialogTitle = forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.AlertDialogTitle>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.AlertDialogTitle>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.AlertDialogTitle
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = "AlertDialogTitle";

export const AlertDialogDescription = forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.AlertDialogDescription>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.AlertDialogDescription>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.AlertDialogDescription
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

export const AlertDialogAction = AlertDialogPrimitive.AlertDialogAction;
export const AlertDialogCancel = AlertDialogPrimitive.AlertDialogCancel;
