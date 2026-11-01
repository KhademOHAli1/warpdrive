interface Endpoint {
  invalidate: () => Promise<unknown>;
}
interface DeliveryReaderUtils {
  email: {
    thread: { get: Endpoint };
    message: { get: Endpoint };
    inbox: { list: Endpoint; unreadCount: Endpoint };
    folders: { sent: Endpoint; archive: Endpoint };
    search: Endpoint;
    listMessagesForDeal: Endpoint;
    listMessagesForContact: Endpoint;
  };
}

// A reviewed source can make an outbound reference appear in another open reader.
// Refresh DTOs as well as collapsed feeds; no private report content enters those caches here.
export function invalidateDeliveryObservationReaders(utils: DeliveryReaderUtils): void {
  const email = utils.email;
  const endpoints = [
    email.thread.get,
    email.message.get,
    email.inbox.list,
    email.inbox.unreadCount,
    email.folders.sent,
    email.folders.archive,
    email.search,
    email.listMessagesForDeal,
    email.listMessagesForContact,
  ];
  void Promise.allSettled(
    endpoints.map((endpoint) => Promise.resolve().then(() => endpoint.invalidate())),
  );
}
