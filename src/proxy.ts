import { type NextRequest, NextResponse } from "next/server";
import { PRIVACY_CASE_PATH_HEADER, privacyCaseReturnPath } from "@/features/privacy/requestPath";

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(PRIVACY_CASE_PATH_HEADER);
  const path = privacyCaseReturnPath(request.nextUrl.pathname);
  if (path !== null) requestHeaders.set(PRIVACY_CASE_PATH_HEADER, path);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

// App page paths scrub caller hints. API handlers retain their existing body transport.
// Native route/action checks still own authorization.
export const config = { matcher: "/((?!api/|api$).*)" };
