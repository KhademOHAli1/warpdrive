// Next invokes instrumentation in both runtimes. Import Node-only dependencies only there.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation.node");
    await registerNode();
  }
}
