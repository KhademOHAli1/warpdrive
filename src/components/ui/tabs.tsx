"use client";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import * as RadixTabs from "./primitives/tabs";

// SANCTIONED replacement for hand-rolled `role="tablist"` + active-index tab strips.
// Radix brings roving-tabindex keyboard nav (arrows/Home/End), aria wiring, and
// focus management the hand-rolled versions dropped. Default look is the app's
// underline strip; pass className on List/Trigger to match a specific surface
// (e.g. the pill style used on contact/lead timelines).

export const Tabs = RadixTabs.Tabs;

// The app's two parity-locked tab looks, as TabsTrigger className presets so the
// several strips that share a look stay identical. Active state via data-[state=active].
export const PILL_TAB =
  "rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:font-medium data-[state=active]:text-primary";

// List/Trigger carry only structural + focus/disabled defaults. The app has two
// tab looks (pill and underline) with parity-locked colors, so each surface passes
// its own className and expresses the active state via `data-[state=active]:` utilities
// rather than the old active-index ternary.
export const TabsList = forwardRef<
  React.ElementRef<typeof RadixTabs.TabsList>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.TabsList>
>(({ className, ...props }, ref) => (
  <RadixTabs.TabsList
    ref={ref}
    className={cn(
      "flex h-auto w-auto items-center justify-start rounded-none bg-transparent p-0",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof RadixTabs.TabsTrigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.TabsTrigger>
>(({ className, ...props }, ref) => (
  <RadixTabs.TabsTrigger
    ref={ref}
    className={cn(
      "inline-flex items-center whitespace-nowrap text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  React.ElementRef<typeof RadixTabs.TabsContent>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.TabsContent>
>(({ className, ...props }, ref) => (
  <RadixTabs.TabsContent
    ref={ref}
    className={cn("mt-2 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
