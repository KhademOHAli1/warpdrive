"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import * as DropdownMenuPrimitive from "./primitives/dropdown-menu";

// shadcn Radix Nova DropdownMenu wrapper over @radix-ui/react-dropdown-menu. This is the
// SANCTIONED replacement for the hand-rolled `useMenuDismiss` + absolute-div menus: it brings
// focus trap, keyboard nav (arrows/type-ahead/Escape), and portal for free. See CLAUDE.md
// "Use the design system, never reinvent". A lint rule bans new hand-rolled menus.
export const DropdownMenu = DropdownMenuPrimitive.DropdownMenu;
export const DropdownMenuTrigger = DropdownMenuPrimitive.DropdownMenuTrigger;
export const DropdownMenuSub = DropdownMenuPrimitive.DropdownMenuSub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.DropdownMenuRadioGroup;

export const DropdownMenuSubTrigger = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.DropdownMenuSubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.DropdownMenuSubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.DropdownMenuSubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
      inset === true && "ps-8",
      className,
    )}
    {...props}
  >
    {children}
  </DropdownMenuPrimitive.DropdownMenuSubTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export const DropdownMenuSubContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.DropdownMenuSubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.DropdownMenuSubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.DropdownMenuSubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:animate-none",
      className,
    )}
    {...props}
  />
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.DropdownMenuContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.DropdownMenuContent>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.DropdownMenuContent
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 [transform-origin:var(--radix-dropdown-menu-content-transform-origin)] motion-reduce:animate-none",
      className,
    )}
    {...props}
  />
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.DropdownMenuItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.DropdownMenuItem> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.DropdownMenuItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors duration-150 focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset === true && "ps-8",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.DropdownMenuCheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.DropdownMenuCheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.DropdownMenuCheckboxItem
    ref={ref}
    checked={checked}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 ps-8 pe-2 text-sm outline-none transition-colors duration-150 focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </DropdownMenuPrimitive.DropdownMenuCheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.DropdownMenuRadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.DropdownMenuRadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.DropdownMenuRadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 ps-8 pe-2 text-sm outline-none transition-colors duration-150 focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </DropdownMenuPrimitive.DropdownMenuRadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export const DropdownMenuLabel = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.DropdownMenuLabel>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.DropdownMenuLabel> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.DropdownMenuLabel
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset === true && "ps-8", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.DropdownMenuSeparator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.DropdownMenuSeparator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.DropdownMenuSeparator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
