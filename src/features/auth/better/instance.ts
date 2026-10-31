import { db } from "@/db/client";
import { createBetterAuth } from "./auth";

let instance: ReturnType<typeof createBetterAuth> | undefined;
export function getBetterAuth() {
  instance ??= createBetterAuth(db);
  return instance;
}
