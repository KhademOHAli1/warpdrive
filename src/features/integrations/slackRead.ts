import { ERROR_IDS } from "@/constants/errorIds";
import { err, type Result } from "@/types/result";
import {
  decodeSlackReadResponse,
  type SlackReadFailure,
  slackReadFailure,
} from "./slackReadFailure";

const SLACK_READ_TIMEOUT_MS = 10_000;
interface SlackReadRequest {
  method: "auth.test" | "conversations.list";
  token: string;
  body?: Record<string, string>;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}

function overdue(signal: AbortSignal, deadlineAt: number): boolean {
  signal.throwIfAborted();
  return performance.now() >= deadlineAt;
}

function timeoutFailure(): Result<never, SlackReadFailure> {
  return err(slackReadFailure("transient_outage", "timed_out", ERROR_IDS.SLACK_UNAVAILABLE));
}

async function performRead(
  args: SlackReadRequest,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<Result<unknown, SlackReadFailure>> {
  const options = {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(args.body ?? {}),
  } satisfies RequestInit;
  if (overdue(signal, deadlineAt)) return timeoutFailure();
  const response = await (args.fetcher ?? fetch)(`https://slack.com/api/${args.method}`, options);
  if (overdue(signal, deadlineAt)) return timeoutFailure();
  const legacyErrorId = response.ok
    ? ERROR_IDS.SLACK_REQUEST_FAILED
    : response.status === 429
      ? ERROR_IDS.SLACK_RATE_LIMITED
      : ERROR_IDS.SLACK_UNAVAILABLE;
  const retryAfter = response.headers.get("Retry-After");
  if (response.status === 429)
    return err(slackReadFailure("rate_limited", "rate_limited", legacyErrorId, retryAfter));
  if (response.status >= 500)
    return err(slackReadFailure("transient_outage", "unavailable", legacyErrorId));
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    if (overdue(signal, deadlineAt)) return timeoutFailure();
    return err(slackReadFailure("invalid_response", "invalid_response", legacyErrorId));
  }
  if (overdue(signal, deadlineAt)) return timeoutFailure();
  const decoded = decodeSlackReadResponse({ data, httpOk: response.ok, legacyErrorId, retryAfter });
  return overdue(signal, deadlineAt) ? timeoutFailure() : decoded;
}

export async function requestSlackRead(
  args: SlackReadRequest,
): Promise<Result<unknown, SlackReadFailure>> {
  args.signal.throwIfAborted();
  const deadlineAt = performance.now() + SLACK_READ_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let rejectStopped: (reason: unknown) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject;
  });
  const onAbort = () => {
    controller.abort();
    rejectStopped(args.signal.reason);
  };
  args.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectStopped(new DOMException("Slack read deadline elapsed", "TimeoutError"));
  }, SLACK_READ_TIMEOUT_MS);
  try {
    if (overdue(args.signal, deadlineAt)) return timeoutFailure();
    // Race observes late rejection too. performRead checks abort before parsing a late response.
    const result = await Promise.race([performRead(args, controller.signal, deadlineAt), stopped]);
    // Timer callbacks cannot run during synchronous work or an uninterrupted microtask chain.
    if (overdue(args.signal, deadlineAt)) {
      controller.abort();
      return timeoutFailure();
    }
    return result;
  } catch {
    args.signal.throwIfAborted();
    return err(
      slackReadFailure(
        "transient_outage",
        timedOut || performance.now() >= deadlineAt ? "timed_out" : "unavailable",
        ERROR_IDS.SLACK_UNAVAILABLE,
      ),
    );
  } finally {
    clearTimeout(timer);
    args.signal.removeEventListener("abort", onAbort);
  }
}
