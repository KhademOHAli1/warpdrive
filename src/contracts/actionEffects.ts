/** Response instructions from backend commands, applied only in a writable Web response. */
export interface ActionEffects {
  revalidatePaths: string[];
}
