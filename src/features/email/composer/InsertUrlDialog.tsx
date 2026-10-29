"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import type { EmailMessages } from "@/features/email/emailMessages";
import { useEmailMessages } from "@/features/email/useEmailMessages";

export type InsertUrlKind = "link" | "image";

const LINK_ALLOWED_SCHEMES = /^(https?:|mailto:)/i;
const IMAGE_ALLOWED_SCHEMES = /^(https?:|data:image\/)/i;

function localizedCOPY(E: EmailMessages) {
  return {
    link: {
      title: E._extra.insert_link,
      description: E._extra.add_an_http_https_or_email_link,
      label: E._extra.link_url,
      placeholder: "https://example.com…",
      action: E._extra.insert_link,
      error: E._extra.enter_an_http_https_or_mailto_url,
    },
    image: {
      title: E._extra.insert_image,
      description: E._extra.add_an_http_https_or_data_image_url,
      label: E._extra.image_url,
      placeholder: "https://example.com/image.png…",
      action: E._extra.insert_image,
      error: E._extra.enter_an_http_https_or_data_image_url,
    },
  } as const;
}

interface InsertUrlDialogProps {
  kind: InsertUrlKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (url: string) => void;
}

export function InsertUrlDialog({
  kind,
  open,
  onOpenChange,
  onInsert,
}: InsertUrlDialogProps): React.ReactNode {
  const E = useEmailMessages();

  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const copy = localizedCOPY(E)[kind];

  function submit(): void {
    const trimmed = value.trim();
    const allowed = kind === "link" ? LINK_ALLOWED_SCHEMES : IMAGE_ALLOWED_SCHEMES;
    if (!allowed.test(trimmed)) {
      setError(copy.error);
      return;
    }
    onInsert(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div>
            <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
              {copy.label}
            </label>
            <Input
              id={inputId}
              name={`${kind}Url`}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error !== null) setError(null);
              }}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={copy.placeholder}
            />
            {error !== null ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{E._extra.cancel}</Button>
            </DialogClose>
            <Button type="submit">{copy.action}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
