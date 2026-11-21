import { ensureCsrfAction } from "@/features/auth/csrfRefresh";
import { readCsrfToken } from "@/utils/csrfCookie";

export async function publicationCsrfToken() {
  const token = readCsrfToken();
  if (token !== null) return token;
  await ensureCsrfAction();
  return readCsrfToken();
}
