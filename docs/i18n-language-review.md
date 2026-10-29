# Contextual Persian language review

Reviewed 2026-10-29: the English/Persian `settings`, `sales`, `shell`, and `quickAdd` catalogs against `docs/i18n-glossary.md`, plus the relevant rendering and input paths. This is a source/catalog review, not browser acceptance. Catalogs were not changed during this review.

The core CRM terms, destructive confirmations, sign-in/out copy, and quick-add labels generally preserve the English meaning. No delete/cancel reversal or permission-grant inversion was found. The reviewed catalog text uses Persian ی/ک; no Arabic ي/ك substitutions were found. Brand names, IANA zones, and external product control names should remain identifiable.

## Actionable wording corrections

### P2: The profile timezone fallback does not use the browser

`settings.timezoneNone` currently says «استفاده از تنظیمات پیش‌فرض مرورگر». `ProfileClient.tsx:50` uses it for the empty selection; `accountPreferences.ts:14–17` instead falls back from the profile override to saved regional preferences/cookie fallback, and `preferences.ts:37–38` finally uses UTC. A user can therefore select “browser” and still see another zone.

Replace the existing label in both catalogs:

- English: `Use regional preference (UTC fallback)`
- Persian: `طبق تنظیمات منطقه‌ای (پیش‌فرض: UTC)`

If explanatory help is added, use: «منطقهٔ زمانی این بخش بر تنظیمات منطقه‌ای اولویت دارد. با انتخاب گزینهٔ پیش‌فرض، منطقهٔ زمانی تنظیمات منطقه‌ای استفاده می‌شود؛ اگر تنظیمی موجود نباشد، UTC به کار می‌رود.» Do not promise device detection.

### P2: Remaining request quotas are described as paid credits

`settings._enrichment.settings.testQuotaHourly` / `testQuotaDaily` currently insert «اعتبار». These values come from remaining-call headers (`providers/types.ts:46`, `settings/enrichment/ProviderCard.tsx:61–66`). They are distinct from the paid lookup credits described by `testCost`.

Use these Persian replacements, preserving numeric arguments:

- `testQuotaHourly`: `{left, number} درخواست در ساعت جاری`
- `testQuotaDaily`: `{left, number} درخواست امروز`
- `testQuotaLine`: `درخواست‌های باقی‌مانده: {windows}.`

The caller should join the two windows with `، ` in Persian.

### P2: “Focus” is narrower in Persian than the actual view

`sales.computed.focus` is «پیش رو», suggesting future work. `TimelineTabs.tsx:27` uses this key, while `historyTimeline.ts:124–127` puts every unfinished activity there, including overdue ones.

Set `computed.focus` to `نیازمند پیگیری`. Align `focus_9d3ca` and `focus_c51fa` to the same phrase; contacts already use it. English `Focus` can stay unchanged.

### P2: The rotting badge claims inactivity that is not measured

`sales.rotting_idle_arg0_days_0f4ad` says «راکد؛ … روز بدون فعالیت». `cardIndicators.ts:64–69` measures time since **entering the stage**, even if activities occurred afterward. This misleading meaning also exists in the English “idle” wording; the stage configuration’s «مهلت توقف در مرحله» is accurate.

Replace the badge text in both catalogs:

- English: `Rotting; {arg0, number} days in this stage`
- Persian: `راکد؛ {arg0, number} روز در این مرحله`

### P2: The sales permission error states an exclusive owner/admin rule

`sales.computed.permissionBody` says only the owner or an admin can act. `dealActionError.ts:14–18` uses it for any `PERM_DENIED`, but `permissions/can.ts:17–29` also supports broader and team-scoped permissions. This is inherited English copy, not a Persian translation reversal.

Use:

- English: `You don't have permission to make this change. Ask an admin to review your access.`
- Persian: `اجازهٔ انجام این تغییر را ندارید. از مدیر سامانه بخواهید دسترسی شما را بررسی کند.`

### P3: Filter authorship is confused with assigned responsibility

`sales.computed.copyFilterNote`, used by `createFilterModalCopy.ts:32–36`, says «شما مسئول این فیلتر نیستید». Here ownership concerns the saved filter's creator, not the CRM’s assigned مسئول concept.

Replace with: `این فیلتر را شما ایجاد نکرده‌اید؛ تغییراتتان به‌صورت یک فیلتر جدید ذخیره می‌شود.` Keep the English behavior and saved-filter identifiers unchanged.

### P3: Activity-goal labels require a complete Persian phrase

`GoalsTable.tsx:22–33` combines independently translated words using `settings._extra.goalDisplayLabel`. The current formatter produces **«فعالیت‌ها انجام‌شده، ماهانه»**. Changing the standalone `activities` label would break other contexts.

Add a whole-message activity-goal label and pass the stable action value plus localized interval:

- English: `{action, select, added {Activities added} completed {Activities completed} other {Activities}}, {interval}`
- Persian: `{action, select, added {فعالیت‌های ایجادشده} completed {فعالیت‌های انجام‌شده} other {فعالیت‌ها}}، {interval}`

This needs a typed formatter/caller change, not a global noun replacement. Minor orthographic polish: `sales.computed.requiredField` should say `وارد کردن «{name}» الزامی است.` rather than `واردکردن`.

## Computed display gaps a literal inventory misses

1. **Sales dates and counts still bypass locale preferences.** `DealSidebar.tsx:263–271` renders raw day counts and browser-default `toLocaleDateString()`. `ParticipantsDialog.tsx:84–92` renders raw counts and explicitly formats the next activity with `en-US`. Use the shared number/date formatters with the selected calendar and timezone; retain stored instants and ISO values.
2. **Structured audit values remain raw JSON.** `localizedChangeLabel.ts:17–21,60–69` stringifies contact-point objects. A supported `person.phones` change currently renders `{"label":"Work","value":"09120000000","primary":true}` inside Persian prose. Render the meaningful values and known label/primary metadata contextually; preserve custom labels and phone/email content. For mixed-direction transitions, the unambiguous Persian `changeLog.change` replacement is `{field}: از «{oldValue}» به «{newValue}»`; isolate dynamic values at the rendering boundary rather than relying on an arrow’s visual order.
3. **Missing goal assignee names leak a machine enum.** `GoalsTable.tsx:83–85` falls back to `g.assigneeKind`. Use localized unavailable/unknown labels such as «کاربر نامشخص» / «تیم نامشخص» while retaining the enum in storage.
4. **Resolved in contact follow-up: history count badges.** `historyTabCounts.ts` now accepts a count formatter, and `ContactHistoryTabs` supplies the selected locale formatter. The helper preserves its legacy English default and omits zero/unknown badges.
5. **Resolved in contact follow-up: email loading/error text.** `ContactTimelinePanel` now supplies `useEmailMessages()` to `emailTabStatusLabel`, keeping localized loading, error and successful-empty states distinct without changing email data or queries.

Shell and quick-add had no additional material semantic findings in this review. Existing cross-feature differences such as «ارزش»/«مبلغ» or «شرکت‌کننده»/«فرد مرتبط» deserve later terminology cleanup, but the behavior and display gaps above take priority.

Contact follow-up validation: `contactComputedLocale.test.tsx` and `historyTabCounts.test.ts` pass 11 tests, covering Persian digits, English defaults, zero/unknown count handling, and distinct localized email loading/error states. The contact boundary now supplies `useEmailMessages()`; stored counts, tab IDs and email data are unchanged.
