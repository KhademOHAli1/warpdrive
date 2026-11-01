"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function SavedViewUnavailable({
  name,
  onClear,
  missing = false,
}: {
  name?: string;
  onClear: () => void;
  missing?: boolean;
}): React.ReactNode {
  const t = useAppTranslations("viewCompatibility");
  return (
    <div role="alert" className="m-2 basis-full rounded-md border p-3 text-sm">
      <p className="font-medium">{t("title")}</p>
      {name !== undefined && name !== "" && (
        <p>
          <bdi dir="auto">{name}</bdi>
        </p>
      )}
      <p className="mt-1 text-muted-foreground">{t(missing ? "missingBody" : "body")}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onClear}>
        {t("showAll")}
      </Button>
    </div>
  );
}
