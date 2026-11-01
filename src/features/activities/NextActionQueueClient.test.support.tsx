import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { LocaleProvider, useSetLocalePreferences } from "@/features/i18n/LocaleProvider";
import { NextActionQueueClient } from "./NextActionQueueClient";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function SaveTimeZone() {
  const choose = useSetLocalePreferences();
  return (
    <button type="button" onClick={() => void choose({ timeZone: "Asia/Tehran" })}>
      Save account timezone
    </button>
  );
}

export function renderQueueClient(currentUserId = "user-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function tree(userId: string, timeZone = "Europe/Berlin") {
    return (
      <QueryClientProvider client={client}>
        <LocaleProvider locale="en" calendar="gregory" timeZone={timeZone}>
          <SaveTimeZone />
          <NextActionQueueClient currentUserId={userId} />
        </LocaleProvider>
      </QueryClientProvider>
    );
  }
  const view = render(tree(currentUserId));
  return {
    client,
    ...view,
    changeUser: (userId: string) => view.rerender(tree(userId)),
    changeTimeZone: (zone: string) => view.rerender(tree(currentUserId, zone)),
  };
}
