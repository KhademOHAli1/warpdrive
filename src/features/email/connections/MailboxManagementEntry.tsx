"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { mailboxConnectionMessages } from "./messages";

export function MailboxManagementEntry() {
  const copy = mailboxConnectionMessages(useLocale());
  return (
    <div className="flex justify-end">
      <Link
        href="/settings/email-sync"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "min-h-11 max-w-full whitespace-normal text-start",
        )}
      >
        <Mail className="size-4 shrink-0" aria-hidden="true" />
        {copy.title}
      </Link>
    </div>
  );
}
