// Registry dialogs add a responsive width cap. Promote CRM callers' existing base caps so
// a caller's max-w-3xl still wins at desktop widths without changing every form's public API.
export function responsiveMaxWidth(className: string | undefined): string {
  return (className ?? "")
    .split(/\s+/)
    .filter((token) => token.startsWith("max-w-"))
    .map((token) => `sm:${token}`)
    .join(" ");
}
