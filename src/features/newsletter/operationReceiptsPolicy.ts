// These procedures render or export a read-only representation. Their response can contain
// authored HTML or CSV and must never be written into the receipt store.
const transientOperations = new Set(["campaigns.preview", "templates.preview", "admin.export"]);

export function needsNewsletterReceipt(operation: string): boolean {
  return !transientOperations.has(operation);
}
