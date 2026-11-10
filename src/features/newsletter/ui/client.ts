"use client";

import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";

type Input = Record<string, unknown>;

export function useNewsletterRead<T>(operation: string, input: Input = {}, enabled = true) {
  const query = trpc.newsletter.read.useQuery({ operation, input }, { enabled, retry: false });
  return { ...query, data: query.data as T | undefined };
}

export function useNewsletterWrite<T = unknown>() {
  const utils = trpc.useUtils();
  const mutation = trpc.newsletter.write.useMutation({
    retry: false,
    onSettled: () => {
      void utils.newsletter.read.invalidate();
    },
  });
  return {
    run: async (operation: string, input: Input = {}) =>
      (await mutation.mutateAsync({ operation, input, csrfToken: readCsrfToken() })) as T,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
