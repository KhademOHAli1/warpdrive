import { NextResponse } from "next/server";
import { env } from "@/config/env";

// Old Google callbacks cannot bypass invitation or MFA policy after the cutover.
export function GET(): Response {
  return NextResponse.redirect(new URL("/login?error=auth_failed", env.BASE_URL));
}
