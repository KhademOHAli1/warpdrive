import type { Result } from "@/types/result";
import type { DeliveryObservationMessageRef } from "./deliveryObservationMessageRefs";
import type {
  DeliveryObservationError,
  DeliveryObservationView,
  DeliveryReviewInput,
  DeliveryReviewState,
  DeliveryReviewTarget,
} from "./deliveryObservationTypes";

export interface DeliveryObservationReaderScope {
  accountId: string;
  messageId: string;
  threadId?: string;
  reference: DeliveryObservationMessageRef;
}

export interface DeliveryObservationReaderState {
  reports: DeliveryObservationView[];
  targets: DeliveryReviewTarget[];
  loading: boolean;
  error: DeliveryObservationError | null;
  generation: number;
  refresh: () => void;
  onReview: (
    input: DeliveryReviewInput,
  ) => Promise<Result<DeliveryReviewState, DeliveryObservationError>>;
}
