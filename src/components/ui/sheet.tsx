"use client";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { responsiveMaxWidth } from "./adapterClasses";
import { useDirection } from "./direction";
import {
  Sheet as ShadcnSheet,
  SheetContent as ShadcnSheetContent,
  SheetTitle as ShadcnSheetTitle,
  SheetClose,
} from "./primitives/sheet";

export const Sheet = ShadcnSheet;
export const SheetContent = forwardRef<
  React.ElementRef<typeof ShadcnSheetContent>,
  React.ComponentPropsWithoutRef<typeof ShadcnSheetContent>
>(({ className, children, side, ...props }, ref) => {
  const direction = useDirection();
  const t = useAppTranslations("sharedUi");
  const sizing = cn("w-full max-w-3xl", className);
  const widthTokens = `${sizing} ${responsiveMaxWidth(sizing)}`
    .split(/\s+/)
    .filter((token) => /(^|:)(max-w|w)-/.test(token));
  const sideSizing = widthTokens
    .flatMap((token) => [`data-[side=right]:${token}`, `data-[side=left]:${token}`])
    .join(" ");
  return (
    <ShadcnSheetContent
      ref={ref}
      dir={direction}
      side={side ?? (direction === "rtl" ? "left" : "right")}
      showCloseButton={false}
      className={cn(
        "h-full gap-0 overflow-y-auto border-s bg-background motion-reduce:animate-none",
        sizing,
        sideSizing,
      )}
      {...props}
    >
      {children}
      <SheetClose className="absolute end-1 top-1 flex size-10 items-center justify-center rounded-sm opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-5" strokeWidth={2.25} />
        <span className="sr-only">{t("close")}</span>
      </SheetClose>
    </ShadcnSheetContent>
  );
});
SheetContent.displayName = "SheetContent";
export const SheetTitle = forwardRef<
  React.ElementRef<typeof ShadcnSheetTitle>,
  React.ComponentPropsWithoutRef<typeof ShadcnSheetTitle>
>(({ className, ...props }, ref) => (
  <ShadcnSheetTitle
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";
