"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useSharedBlocksMessages } from "../sharedBlocksMessages";

export interface BlockVariableChoice {
  id: string;
  label: string;
  path: string;
  type: string;
  group: string;
  available?: boolean;
  reason?: string;
}
export function BlockVariablePicker({
  open,
  onOpenChange,
  choices,
  onChoose,
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choices: readonly BlockVariableChoice[];
  onChoose: (id: string) => void;
  disabled?: boolean;
}) {
  const L = useSharedBlocksMessages();
  const [search, setSearch] = useState("");
  const matches = choices.filter((choice) =>
    `${choice.group} ${choice.label} ${choice.path} ${L.types[choice.type] ?? choice.type}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{L.chooseVariable}</DialogTitle>
          <DialogDescription>{L.variableHint}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={L.searchVariables}
          placeholder={L.searchVariables}
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="space-y-3">
          {[...new Set(matches.map((choice) => choice.group))].map((group) => (
            <section key={group}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground" dir="auto">
                {group}
              </h3>
              {matches
                .filter((choice) => choice.group === group)
                .map((choice) => (
                  <Button
                    key={choice.id}
                    variant="ghost"
                    className="h-auto min-h-9 w-full justify-start whitespace-normal px-2 py-2 text-start"
                    disabled={disabled || choice.available === false}
                    onClick={() => {
                      onChoose(choice.id);
                      onOpenChange(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs" dir="auto">
                        {choice.label}
                      </span>
                      <span
                        className="mt-0.5 block text-[10px] font-normal text-muted-foreground"
                        dir="auto"
                      >
                        {choice.reason ?? `${choice.path} · ${L.types[choice.type] ?? choice.type}`}
                      </span>
                    </span>
                  </Button>
                ))}
            </section>
          ))}
          {matches.length === 0 && (
            <p className="py-4 text-xs text-muted-foreground">{L.noVariables}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
