"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/Textarea";
import { useNewsletterRead } from "@/features/newsletter/ui/client";
import { AudienceReadError } from "./components";
import type { ListSignupEmbed, MailingList } from "./contracts";
import { useAudienceMessages } from "./messages";

export function ListSignupDialog({ row, close }: { row: MailingList; close: () => void }) {
  const L = useAudienceMessages();
  const [copy, setCopy] = useState<"copied" | "copyError" | null>(null);
  const read = useNewsletterRead<ListSignupEmbed>("lists.signupEmbed", { id: row.id });
  const data = read.data;
  const statuses = {
    signupDisabled: L.signupDisabled,
    listUnavailable: L.signupListUnavailable,
    originMismatch: L.signupOriginMismatch,
    verificationRequired: L.signupVerificationRequired,
    serviceUnsupported: L.signupServiceUnsupported,
  };

  function copyCode(html: string) {
    void navigator.clipboard
      .writeText(html)
      .then(() => setCopy("copied"))
      .catch(() => setCopy("copyError"));
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{L.signupEmbed}</DialogTitle>
          <DialogDescription>
            <bdi dir="auto">{row.name}</bdi>
          </DialogDescription>
        </DialogHeader>
        {read.isLoading && (
          <p role="status" className="text-sm text-muted-foreground">
            {L.loading}
          </p>
        )}
        {read.error !== null && <AudienceReadError read={read} />}
        {read.error === null &&
          data &&
          (data.status === "ready" ? (
            <Textarea
              aria-label={L.signupEmbedCode}
              readOnly
              value={data.html}
              dir="ltr"
              rows={4}
              className="font-mono"
            />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {statuses[data.status]}
            </p>
          ))}
        {copy && (
          <p role="status" className="text-sm text-muted-foreground">
            {L[copy]}
          </p>
        )}
        <DialogFooter>
          {read.error === null && data?.status === "ready" && (
            <>
              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                {L.openSignupForm}
              </a>
              <Button onClick={() => copyCode(data.html)}>{L.copySignupCode}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
