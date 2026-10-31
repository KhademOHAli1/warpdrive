"use client";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { AuthField } from "./AuthField";
import { AuthFeedback, useAuthAction } from "./useAuthAction";
import { mutationSchema, workflowRequest } from "./workflowRequest";

export function AssistedRecovery() {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const task = useAuthAction();
  const [email, setEmail] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    void task.run(
      async (signal) => {
        const result = await workflowRequest("recovery-request", mutationSchema, signal, {
          email: email.trim(),
        });
        return result.ok ? { data: result.data } : { error: result.error };
      },
      () => task.setNotice(L.recoveryRequested),
    );
  }
  return (
    <section className="space-y-4 border-t pt-4">
      <h2 className="text-sm font-semibold">{L.assistedRecoveryTitle}</h2>
      <p className="text-sm text-muted-foreground">{L.assistedRecoveryDescription}</p>
      <form onSubmit={submit} className="space-y-3">
        <AuthField
          label={L.email}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={task.busy}>
          {L.requestRecovery}
        </Button>
      </form>
      <AuthFeedback error={task.error} notice={task.notice} />
    </section>
  );
}
