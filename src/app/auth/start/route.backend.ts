import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { safeLoginReturnPath } from "@/features/auth/loginReturn";

// Legacy entrypoint no longer creates custom Google sessions.
export function GET(request: Request): Response {
  const url = new URL("/login", env.BASE_URL);
  url.searchParams.set("next", safeLoginReturnPath(new URL(request.url).searchParams.get("next")));
  return NextResponse.redirect(url);
}
