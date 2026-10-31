"use client";
import { Eye, EyeOff } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { authScreensMessagesForLocale } from "../authScreensMessages";

export function AuthField({
  label,
  help,
  type = "text",
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & {
  label: string;
  help?: string;
  type?: string;
}): ReactNode {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const password = type === "password";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          {...props}
          className={cn(password && "pe-11", "h-10", className)}
          id={id}
          type={password && visible ? "text" : type}
          dir={type === "email" || password ? "ltr" : "auto"}
          aria-describedby={help !== undefined ? `${id}-help` : undefined}
        />
        {password && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute end-0 top-0 h-full w-10 rounded-s-none text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-label={visible ? L.hidePassword : L.showPassword}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
      {help !== undefined && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}
