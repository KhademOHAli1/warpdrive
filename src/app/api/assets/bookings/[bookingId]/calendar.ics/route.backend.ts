import {
  bookingCalendarResponse,
  readBookingCalendarDownload,
} from "@/features/assets/bookings/feedService";
import { createContext } from "@/server/trpc/context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  const { db, session } = await createContext();
  if (session === null) return bookingCalendarResponse(null);
  const { bookingId } = await params;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  const calendar = await readBookingCalendarDownload(db, session, bookingId, signal);
  return bookingCalendarResponse(calendar, true);
}
