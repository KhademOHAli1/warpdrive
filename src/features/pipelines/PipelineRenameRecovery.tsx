import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface Props {
  failureId: string | null;
  blocked: boolean;
  freshRead: boolean;
  savedName: string;
  onRefresh: () => void;
  onReview: () => void;
}

export function PipelineRenameRecovery(props: Props): ReactNode {
  const t = useAppTranslations("sales");
  if (props.failureId === ERROR_IDS.PIPELINE_FRESH_AUTH_REQUIRED)
    return (
      <Link
        href="/settings/security"
        target="_blank"
        rel="noreferrer"
        className="mb-3 text-sm font-medium text-primary underline"
      >
        {t("computed.renameVerifyIdentity")}
      </Link>
    );
  if (!props.blocked) return null;
  return (
    <div className="mb-3 space-y-2 rounded-md border p-3 text-sm">
      <Button variant="outline" size="sm" onClick={props.onRefresh}>
        {t("computed.renameRefreshVersion")}
      </Button>
      {props.freshRead && (
        <>
          <p role="status">
            {t("computed.renameSavedName")} <bdi dir="auto">{props.savedName}</bdi>
          </p>
          <p className="text-muted-foreground">{t("computed.renameReviewHint")}</p>
          <Button variant="outline" size="sm" onClick={props.onReview}>
            {t("computed.renameKeepDraft")}
          </Button>
        </>
      )}
    </div>
  );
}
