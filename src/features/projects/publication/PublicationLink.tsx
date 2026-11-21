"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";

export function PublicationLink({
  href,
  children,
  variant,
  size,
  current = false,
}: {
  href: string;
  children: string;
  variant?: "outline" | "ghost";
  size?: "sm";
  current?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={current ? "page" : undefined}
      className={buttonVariants({ variant, size })}
    >
      {children}
    </Link>
  );
}
