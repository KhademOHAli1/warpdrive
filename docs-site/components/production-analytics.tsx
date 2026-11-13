"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { DOCS_ORIGIN } from "@/lib/site";

const GA_ID = "G-WN9BMJ5QD6";
const AHREFS_SITE_ID = "aD9VD8YqPwtacLzWcunl9g"; // gitleaks:allow — public site identifier

type AnalyticsWindow = Window & { dataLayer?: unknown[] };

export function ProductionAnalytics() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    if (window.location.origin !== DOCS_ORIGIN || lastPage.current === pathname) return;

    const analytics = window as AnalyticsWindow;
    const queue = (analytics.dataLayer ??= []);
    function gtag(..._parameters: unknown[]) {
      queue.push(arguments);
    }

    if (lastPage.current === null) {
      gtag("js", new Date());
      gtag("config", GA_ID, { anonymize_ip: true, send_page_view: false });
      setEnabled(true);
    }

    // Track page navigation without including search queries or heading fragments.
    const pageReferrer =
      lastPage.current === null ? document.referrer : `${DOCS_ORIGIN}${lastPage.current}`;
    gtag("event", "page_view", {
      send_to: GA_ID,
      page_location: `${DOCS_ORIGIN}${pathname}`,
      page_referrer: pageReferrer,
      page_title: document.title,
    });
    lastPage.current = pathname;
  }, [pathname]);

  if (!enabled) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
      <Script src="https://analytics.ahrefs.com/analytics.js" data-key={AHREFS_SITE_ID} />
    </>
  );
}
