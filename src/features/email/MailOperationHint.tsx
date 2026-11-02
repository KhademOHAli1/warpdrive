"use client";
import { cloneElement, type ReactElement, useId } from "react";
import { Tip } from "@/components/ui/tooltip";
import { useEmailMessages } from "./useEmailMessages";

export function MailOperationHint({
  enabled,
  reason,
  children,
}: {
  enabled: boolean;
  reason?: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const E = useEmailMessages();
  const id = useId();
  const label = reason ?? E.remoteActions.unavailable;
  return enabled ? (
    children
  ) : (
    <>
      <Tip label={label}>
        <span className="inline-flex">{cloneElement(children, { "aria-describedby": id })}</span>
      </Tip>
      <span id={id} className="sr-only">
        {label}
      </span>
    </>
  );
}
