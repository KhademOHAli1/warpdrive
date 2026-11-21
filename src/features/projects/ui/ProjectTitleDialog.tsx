import { type FormEvent, type ReactElement, type ReactNode, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { ProjectResult } from "../contracts";
import type { ProjectsTranslator } from "./projectMessages";
import type { ProjectWriteError } from "./projectWrites";

export function ProjectWriteNotice({
  error,
  labels,
}: {
  error: ProjectWriteError | null;
  labels: ProjectsTranslator;
}) {
  return error === null ? null : (
    <p role="alert" className="py-2 text-sm text-destructive">
      {labels(`errors.${error}`)}
    </p>
  );
}

export function ProjectTitleDialog({
  labels,
  title,
  description,
  field,
  maxLength,
  trigger,
  initialTitle,
  pending,
  submit,
  extra,
  canSubmit = true,
  onOpen,
}: {
  labels: ProjectsTranslator;
  title: string;
  description: string;
  field: string;
  maxLength: number;
  trigger: ReactElement;
  initialTitle?: string;
  pending: boolean;
  submit: (title: string, getRequestId: () => string) => Promise<ProjectResult<unknown>>;
  extra?: ReactNode;
  canSubmit?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialTitle ?? "");
  const [error, setError] = useState<ProjectWriteError | null>(null);
  const requestId = useRef<string | null>(null);
  const fieldId = useId();

  function changeOpen(next: boolean) {
    if (pending) return;
    if (next) {
      setValue(initialTitle ?? "");
      setError(null);
      requestId.current = null;
      onOpen?.();
    }
    setOpen(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || pending || value.trim() === "") return;
    setError(null);
    const result = await submit(value.trim(), () => (requestId.current ??= crypto.randomUUID()));
    if (result.ok) setOpen(false);
    else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto`}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="space-y-4">
          <div className="grid gap-2">
            <label htmlFor={fieldId} className="text-sm font-medium">
              {field}
            </label>
            <Input
              id={fieldId}
              dir="auto"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={maxLength}
              disabled={pending}
              required
            />
          </div>
          {extra}
          <ProjectWriteNotice error={error} labels={labels} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              {labels("actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                !canSubmit || pending || value.trim() === "" || value.trim() === initialTitle
              }
            >
              {labels(pending ? "actions.saving" : "actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
