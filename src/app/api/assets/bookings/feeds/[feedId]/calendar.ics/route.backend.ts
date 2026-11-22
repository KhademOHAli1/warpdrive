import { db } from "@/db/client";
import {
  bookingCalendarResponse,
  readBookingCalendarSubscription,
} from "@/features/assets/bookings/feedService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ feedId: string }> },
): Promise<Response> {
  const tokens = new URL(request.url).searchParams.getAll("token");
  const token = tokens[0];
  if (tokens.length !== 1 || token === undefined) return bookingCalendarResponse(null);
  const { feedId } = await params;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  return bookingCalendarResponse(await readBookingCalendarSubscription(db, feedId, token, signal));
}
