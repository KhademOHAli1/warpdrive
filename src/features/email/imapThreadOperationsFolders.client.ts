"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { listThreadMoveFoldersAction } from "./imapThreadOperationsActions";
import type { ImapMoveFolder } from "./imapThreadOperationsList";

export function useImapMoveFolders(threadId: string) {
  const report = useActionError();
  const [folders, setFolders] = useState<ImapMoveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const activeThread = useRef(threadId);
  const reload = useCallback(() => {
    const requested = ++generation.current;
    setLoading(true);
    setFailed(false);
    void listThreadMoveFoldersAction(readCsrfToken(), { threadId })
      .then((result) => {
        if (requested !== generation.current || activeThread.current !== threadId) return;
        if (result.ok)
          setFolders(result.value.folders.filter((folder) => folder.readOnly !== true));
        else {
          setFailed(true);
          report(result.error.id);
        }
      })
      .catch(() => {
        if (requested === generation.current) {
          setFailed(true);
          report("E_MAIL_001");
        }
      })
      .finally(() => {
        if (requested === generation.current) setLoading(false);
      });
  }, [threadId, report]);
  const cancel = useCallback(() => {
    generation.current += 1;
  }, []);
  useEffect(() => {
    activeThread.current = threadId;
    return cancel;
  }, [cancel, threadId]);
  return { folders, loading, failed, reload, cancel };
}
