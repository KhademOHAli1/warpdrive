"use client";

import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { WorkflowPanelResize, workflowPanelWidth } from "./WorkflowPanelResize";
import styles from "./workflowEditorSplit.module.css";

export function WorkflowEditorSplit({
  children,
  canvas,
  panelLabel,
  open,
  onClose,
}: {
  children: ReactNode;
  canvas: ReactNode;
  panelLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const panelId = useId();
  const [width, setWidth] = useState<number>(workflowPanelWidth.initial);
  const [resizing, setResizing] = useState(false);
  const panelStyle: CSSProperties & { "--workflow-panel-width": string } = {
    "--workflow-panel-width": `${width}px`,
  };

  return (
    <div className={styles.split} style={panelStyle}>
      <div className={styles.canvas}>{canvas}</div>
      {open && (
        <WorkflowPanelResize
          panelId={panelId}
          width={width}
          onWidthChange={setWidth}
          onResizingChange={setResizing}
          onClose={onClose}
        />
      )}
      <div className={styles.drawer} data-open={open} data-resizing={resizing} inert={!open}>
        <aside id={panelId} className={styles.panel} aria-label={panelLabel} aria-hidden={!open}>
          {children}
        </aside>
      </div>
    </div>
  );
}
