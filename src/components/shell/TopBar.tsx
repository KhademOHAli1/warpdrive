import Link from "next/link";
import type React from "react";
import { APP_NAME } from "@/constants/app";
import { getAppTranslations } from "@/features/i18n/server";
import { NotificationsBell } from "@/features/notifications/ui/NotificationsBell";
import { GlobalAddMenu } from "@/features/quick-add/GlobalAddMenu";
import type { Appearance } from "@/features/theme/appearance";
import { MobileNavTrigger } from "./MobileNavTrigger";
import { SearchTrigger } from "./SearchTrigger";
import styles from "./TopBar.module.css";
import { UserMenu } from "./UserMenu";

export async function TopBar({
  userId,
  userName,
  avatarUrl,
  appearance,
}: {
  userId: string;
  userName?: string;
  avatarUrl?: string | null;
  appearance?: Appearance;
}): Promise<React.ReactNode> {
  const t = await getAppTranslations("shell");
  return (
    <header className={styles.header}>
      <div className={styles.brandArea}>
        <MobileNavTrigger />
        <Link href="/pipeline" aria-label={t("home", { app: APP_NAME })} className={styles.brand}>
          <span aria-hidden="true" className={styles.mark} dir="ltr">
            <i />
            <i />
            <i />
          </span>
          <bdi dir="ltr" className={styles.wordmark}>
            {APP_NAME}
          </bdi>
        </Link>
      </div>
      <div className={styles.tools}>
        <search className={styles.searchSlot}>
          <SearchTrigger />
        </search>
        {/* Global quick-add: opens Deal/Lead/Person/Organization create modals from any page. */}
        <GlobalAddMenu triggerClassName={styles.quickAddTrigger} />
      </div>
      <div className={styles.personal}>
        <NotificationsBell userId={userId} />
        <span aria-hidden="true" className={styles.divider} />
        <UserMenu
          userId={userId}
          userName={userName}
          avatarUrl={avatarUrl}
          appearance={appearance}
        />
      </div>
    </header>
  );
}
