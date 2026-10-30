"use client";

import { MOBILE_SIDEBAR_ID, MOBILE_SIDEBAR_TRIGGER_ID, OPEN_SIDEBAR_EVENT } from "@/constants/nav";
import { useMessages } from "@/features/i18n/LocaleProvider";
import styles from "./LeftNav.module.css";
import { FinanceNavGlyph } from "./NavIcons";

export function MobileNavTrigger() {
  const messages = useMessages();
  return (
    <button
      id={MOBILE_SIDEBAR_TRIGGER_ID}
      type="button"
      aria-label={messages.navigation.expand}
      aria-haspopup="dialog"
      aria-controls={MOBILE_SIDEBAR_ID}
      className={styles.mobileTrigger}
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SIDEBAR_EVENT))}
    >
      <FinanceNavGlyph name="bars" size={20} />
    </button>
  );
}
