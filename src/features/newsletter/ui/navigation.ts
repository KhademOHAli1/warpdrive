const labels = {
  en: {
    actions: "Actions",
    campaigns: "Campaigns",
    all: "All campaigns",
    create: "Create new",
    media: "Media",
    templates: "Templates",
    analytics: "Analytics",
    lists: "Lists",
    subscribers: "Subscribers",
  },
  de: {
    actions: "Aktionen",
    campaigns: "Kampagnen",
    all: "Alle Kampagnen",
    create: "Neu erstellen",
    media: "Medien",
    templates: "Vorlagen",
    analytics: "Analysen",
    lists: "Listen",
    subscribers: "Abonnenten",
  },
  fa: {
    actions: "اقدام‌ها",
    campaigns: "کمپین‌ها",
    all: "همه کمپین‌ها",
    create: "ایجاد کمپین",
    media: "رسانه‌ها",
    templates: "الگوها",
    analytics: "تحلیل‌ها",
    lists: "فهرست‌ها",
    subscribers: "مشترکان",
  },
};

export function campaignNavigation(
  locale: keyof typeof labels,
  access: { edit: boolean; operate: boolean },
) {
  const text = labels[locale];
  return {
    actions: text.actions,
    name: text.campaigns,
    items: [
      { href: "/campaigns", label: text.all, exact: true },
      ...(access.edit ? [{ href: "/campaigns/new", label: text.create }] : []),
      { href: "/campaigns/media", label: text.media },
      { href: "/campaigns/templates", label: text.templates },
      { href: "/campaigns/analytics", label: text.analytics },
      ...(access.operate
        ? [
            { href: "/campaigns/lists", label: text.lists },
            { href: "/campaigns/subscribers", label: text.subscribers },
          ]
        : []),
    ],
  };
}
