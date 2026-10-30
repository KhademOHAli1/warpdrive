// The server returns newest first. Rendering the earlier messages first keeps Reply beside Latest.
export function conversationOrder<T>(messages: readonly T[]): {
  earlier: T[];
  latest: T | undefined;
} {
  return { earlier: messages.slice(1).reverse(), latest: messages[0] };
}
