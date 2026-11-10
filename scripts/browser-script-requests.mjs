// A cancelled duplicate is only harmless when a separate request finished
// successfully for the exact script URL in this page.
export function observeScriptRequests(page, origin) {
  const successfulResponses = new WeakSet();
  const loadedUrls = new Set();
  const cancellations = [];

  function isLocalScript(request) {
    const url = new URL(request.url());
    return (
      url.origin === origin &&
      request.method() === "GET" &&
      request.resourceType() === "script" &&
      url.pathname.startsWith("/_next/static/chunks/") &&
      url.pathname.endsWith(".js")
    );
  }

  page.on("response", (response) => {
    const request = response.request();
    if (response.ok() && isLocalScript(request)) successfulResponses.add(request);
  });
  page.on("requestfinished", (request) => {
    if (successfulResponses.has(request)) loadedUrls.add(request.url());
  });

  return {
    deferCancellation(request, detail) {
      if (detail.failure !== "net::ERR_ABORTED" || !isLocalScript(request)) return false;
      cancellations.push({ url: request.url(), detail });
      return true;
    },
    classifyCancellations() {
      const loaded = [];
      const failed = [];
      for (const { url, detail } of cancellations.splice(0)) {
        if (loadedUrls.has(url)) loaded.push(detail);
        else failed.push(detail);
      }
      return { loaded, failed };
    },
  };
}
