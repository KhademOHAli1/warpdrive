"use client";
import type React from "react";
import { useState } from "react";
import { avatarColorClass, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { AvatarFallback, Avatar as ShadcnAvatar } from "./primitives/avatar";

export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}): React.ReactNode {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasPhoto = src !== null && src !== undefined && src !== "" && src !== failedSrc;
  return (
    <ShadcnAvatar
      role={hasPhoto ? undefined : "img"}
      aria-label={hasPhoto ? undefined : name}
      className={cn("inline-flex size-7", className)}
    >
      {hasPhoto ? (
        // biome-ignore lint/performance/noImgElement: native loading preserves immediate avatar semantics
        <img
          src={src}
          alt={name}
          onError={() => setFailedSrc(src)}
          className="size-full rounded-full object-cover"
        />
      ) : (
        <AvatarFallback
          className={cn("text-xs font-semibold text-inherit", avatarColorClass(name))}
        >
          {initials(name)}
        </AvatarFallback>
      )}
    </ShadcnAvatar>
  );
}
