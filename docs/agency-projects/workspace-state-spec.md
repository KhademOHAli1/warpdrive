# Agency workspace states and copy, proposed v1

31 October 2026. Implementation input for AP-01.2 through AP-01.6, reviewed against source `97bf00eff9b23ac62e74b6901c528d06b05ef09a`, `ui-source-inventory.md` and the immutable PRD/architecture. This is a source/design specification. No screen, translation catalog, permission contract or release is implemented or accepted by this document. Native-language review, ICU/key checks, rendered FA/DE/EN journeys and accessibility measurements remain pending.

1 November adoption amendment: Settings `ec9b3f8` supplies the searchable mobile Sheet and committed optional navigation/dialog props described in `settings-adoption.md`. Sales `f006b5a` is also adopted as described in `sales-adoption.md`; preserve its unavailable saved-view states and bounded/cancellable reads instead of broadening an unavailable filter to all records. Use the actual current adapters when implementing this proposal. Statements below about unavailable dirty props refer to the earlier source snapshot, not the newly adopted candidate. Their presence does not add a project request-status or backend recovery API. Combined native UI acceptance remains open.

## Current-shell composition and ownership

Retain the authenticated layout, sidebar/mobile navigation, Inter/Vazirmatn, compact spacing, semantic light/dark colors, action green, focus tokens and existing logical direction behavior. Add feature-local agency content; do not redesign the shell or edit managed primitives. Navigation and route registration require narrow owner review. A proposed Projects destination is not an existing route or server entitlement.

Use `src/components/shell/PageHeading.tsx` with its existing title, crumbs, description and actions inputs. Use the Button, Input, Textarea, Select, Combobox, Badge, Dialog, Popover, Sheet and Tabs adapters in `src/components/ui/`. SettingsSurface is app-local Settings composition, not an assumed public agency component. Preserve the later committed Settings heading/table fixes when adopted. The dirty `SecondaryNavLink.onNavigate` and `ConfirmDialog.secondaryAction` proposals are unavailable at this source.

The existing Combobox supports a controlled search, options, disabled state and a specific accessible label; its caller must obtain bounded permission-filtered choices. The existing DatePicker represents a nullable civil-date string and has no disabled prop. In read-only or pending state render the selected date as text or suppress the interactive picker at the caller; do not invent a disabled prop. Time/zone and reminder controls wait for the actual Calendar contract. No native select, checkbox or hand-built overlay replaces an existing adapter.

## Workspace information and action order

| Surface | Visible hierarchy and primary action | Disclosure and secondary actions |
| --- | --- | --- |
| Project list | Heading; bounded search and owner/state filters; projects with title, client reference where permitted, internal owner, lifecycle and next client update. Primary action: create project when permitted. | Desktop uses aligned rows; mobile uses a single-column summary per project with the same reading order. Filtered counts cover only the current authorized result set. No fee, budget, margin, hidden-project count or globally revealing autocomplete. Invalid saved views show unavailable state, never a broader default result. |
| Project summary | Breadcrumb; authored project name; lifecycle; internal owner; permitted CRM references. Next-actions block first, then deliverables, client updates and assignments. | Keep original client milestone and internal follow-up distinct. Missing owner/date is explicit. Secondary lifecycle actions use a DropdownMenu and a reason form where required. No production state replaces acquisition won/lost. |
| Next client update | Responsible staff, chosen contact/role/channel, explicit next promise, last recorded update and blocker. Primary action depends on intent: schedule an update or record communication that occurred. | Separate contact preferences and original promise history behind secondary disclosure. Complete, snooze and reassign remain separate commands. A completed reminder, prepared draft or copied text does not create communication evidence. |
| Assignment editor | Title/context, selected freelancer contact, accountable internal owner, brief, internal deadline, separate client milestone, production state and blocker. Primary action: save assignment or a named permitted transition. | Deadline details, contact skills/declared availability and history are secondary. Create/select person is explicit and separately authorized. No contact selection creates an auth account or access grant. Prices/rates and client financial fields are absent from this editor and DTO. |
| Feedback and review | Deliverable and exact external version reference; open change requests; round and included-scope state; assigned staff; decision history. Primary action: record feedback or perform a permitted internal review. | Show author/source and recording staff separately, method, occurrence/recording time and bounded evidence reference. Staff-recorded client approval has an explicit provenance label beside the decision. A new version shows a new review requirement; historical approval remains attached to its original version. |

Proposed list default is active/planned/on-hold projects owned by or visible to the actor, with explicit archived access. Final default ordering, page cap and saved-view seam require Sales/query owner review. Stable paging and permission scoping are server responsibilities, not client filtering.

## State contract shared by all five surfaces

| State | Required rendering and allowed recovery | Draft, focus and authority behavior |
| --- | --- | --- |
| Loading | Keep the heading and stable content slots. Announce the localized loading state once. Do not show zero counts, an empty-state illustration or stale private rows as a placeholder. | Initial focus stays at the invoking control/page heading. If reloading an authorized record, retain clearly identified permitted content only while current authority is known. A permission change or sign-out clears sensitive projections immediately. |
| Empty | Distinguish no projects yet, no matching filtered results, no scheduled update, no assignments and no feedback. Offer only the relevant permitted creation/scheduling action; filter-empty offers clear filters. | Do not infer no work from a failed query. Empty choice lists explain no available choices without exposing hidden people. No fake initial deadline, cadence, cost or complete conversation history. |
| Known load/save error | Keep the failed section's scope and give a named retry action. Render bounded localized diagnostics as text. A successful sibling panel remains usable when its authority is current. | A known uncommitted save failure retains the draft in the current editor and keeps focus on the error summary/invalid field. Do not reset to server defaults, close the editor or claim cross-session draft persistence. |
| Retry | Reads rerun the same scoped request. A known uncommitted mutation retry retains the same logical intent and expected revision. | Prevent double submission and preserve current input. A changed request body requires the domain's explicit new intent or conflict resolution, not reuse of an unrelated request receipt. |
| Unknown save result | Explain that saving may have succeeded. Offer check current status using the actual request/record identity; do not present immediate duplicate create/send as recovery. | Retain the local draft and intent until reconciliation. Only a real command receipt/current read can show saved. Do not label copied text, an unknown provider attempt or an inaccessible recovery record as sent. |
| Read-only | Render authorized fields as readable facts and explain that changes are unavailable. Hide actions the current actor cannot perform; do not substitute disabled controls containing private values. | A role name, admin badge, assignee, selected contact or client-provided allow flag never establishes permission. If authority changes while editing, stop submission, clear now-denied data and use the native reauthentication/recovery path when applicable. |
| Revision conflict | Explain concurrent change. Show the latest permitted server values and preserved local edits side by side on desktop, sequentially on mobile. Offer review latest and keep editing; replacement is explicit and uses a fresh revision. | No automatic overwrite or silent last-write-wins. Keep an explicit indication of unsaved edits. If the record becomes inaccessible, use the common unavailable state and clear its cached content instead of exposing a diff. |
| Archived/terminal | Authorized history remains distinguishable from actionable work. No new update, assignment, template activation or external effect is enabled from archived content. | Restore returns to the exact pre-archive lifecycle; it does not silently resume completed/canceled work. Explicit reopen returns terminal projects to planned, with required reason. Assignment approved/canceled reopening remains unavailable until its version policy exists. |
| Module unavailable | Replace agency content with the module-unavailable message and a return-to-CRM action. Preserve history in storage without exposing it through old client caches. | No new agency action or effect is admitted. Any read-only disabled-module history view depends on a separately agreed server policy; this specification does not grant it. Do not show a fabricated licence or provider setup requirement. |
| Missing or inaccessible | One non-probing unavailable message for missing, foreign or newly denied records. Offer return to projects/CRM where that destination is permitted. | No title, existence count, parent name, recipient or financial amount leaks through the error, toast, history entry or previous query cache. |

Client-update queues say last recorded update. For example, an empty WhatsApp log does not assert that no conversation occurred. An overdue badge compares the canonical due intent with the actual selected timezone/date rules, not the interface language. Assignment and update panels stay unavailable if the activity visibility bridge or canonical reminder contract is missing; do not create a second task/reminder implementation to fill the UI.

## Focused assignment interaction

The editor uses a controlled Dialog with one column at 390px and a bounded wider layout on desktop. Field order remains the same in RTL and LTR: project/deliverable context, assignment name, freelancer contact, internal owner, brief, internal deadline, client milestone, blocker and primary/secondary actions. Show a short contact disambiguator only when permitted; preserve original names and addresses. Search/loading/failure states belong to each remote selector.

Open with focus on the first editable field, or the noninteractive title when the dialog is read-only. Field errors are programmatically associated with their controls; after failed submit, focus the first invalid field or a linked error summary. Select/Combobox/Popover retain their adapter keyboard behavior. Tab/Shift+Tab remain inside the Dialog, and Escape first dismisses an open nested picker/menu, then requests editor close. The return target is the invoking assignment row/button; if removed, use the project assignment heading.

A dirty close request uses the existing two-action ConfirmDialog: keep editing or discard changes. Cancel/keep editing returns focus and preserves the draft. Its onConfirm closes the confirmation before work, so state ownership must remain in the parent editor; do not assume it awaits an async save or offers a third action. For an unknown save result, retain a persistent recovery panel instead of using a destructive discard prompt as status recovery. Pending save prevents opening selectors/date pickers or issuing another transition. An outside click must not discard a dirty or unresolved draft.

Blocker entry retains the original promise and identifies the waiting-on party and next follow-up, without implying an external notification. Acceptance action says record acceptance and requires staff provenance/evidence; the UI never presents the freelancer as signed in. Only server-admitted named transitions appear. Internal approval requires the exact reviewed version and current reviewer authority, not merely changing a status field to approved.

Do not require an artifact version before work exists. Awaiting acceptance has no submitted version; working may have none or retain the last submitted reference during changes. The explicit record-submission action requires the actual submitted version reference. Show a retained reference as last submitted version, never as approval of unfinished changes. Submission receipts retain old/new references, and approving a different version conflicts.

## Farsi-first copy inventory

Keys below are proposed feature-local message identifiers, not registered catalog exports. Placeholders are named tokens for future ICU messages; authored names/references remain raw data rendered with appropriate bidi isolation. All variants, plural branches and parameter parity must be tested when the catalog is implemented. These translations are a draft; no native reviewer is claimed.

| Key/purpose | فارسی | Deutsch | English |
| --- | --- | --- | --- |
| projects.title | پروژه‌ها | Projekte | Projects |
| project.create | ایجاد پروژه | Projekt anlegen | Create project |
| project.name | نام پروژه | Projektname | Project name |
| project.summary | نمای کلی پروژه | Projektübersicht | Project overview |
| project.internalOwner | مسئول داخلی | Interne Verantwortung | Internal owner |
| project.nextActions | اقدامات بعدی | Nächste Schritte | Next actions |
| project.clientMilestone | موعد توافق‌شده با مشتری | Mit dem Kunden vereinbarter Termin | Agreed client milestone |
| project.internalDeadline | مهلت داخلی | Interne Frist | Internal deadline |
| project.noDeadline | مهلتی تعیین نشده است | Keine Frist festgelegt | No deadline set |
| project.planned | برنامه‌ریزی‌شده | Geplant | Planned |
| project.active | در حال انجام | In Arbeit | Active |
| project.onHold | متوقف | Pausiert | On hold |
| project.completed | تکمیل‌شده | Abgeschlossen | Completed |
| project.canceled | لغوشده | Abgebrochen | Canceled |
| project.archived | بایگانی‌شده | Archiviert | Archived |
| project.archivedDescription | این پروژه بایگانی شده است. سابقهٔ ثبت‌شدهٔ آن قابل مشاهده است. | Dieses Projekt ist archiviert. Der bisherige Verlauf kann weiterhin eingesehen werden. | This project is archived. Its recorded history is available to view. |
| project.restore | بازیابی از بایگانی | Aus Archiv wiederherstellen | Restore from archive |
| project.reopen | برنامه‌ریزی دوباره | Erneut planen | Reopen for planning |
| project.reason | دلیل تغییر | Grund der Änderung | Reason for change |
| project.empty | هنوز پروژه‌ای ثبت نشده است. | Es wurden noch keine Projekte angelegt. | No projects have been created yet. |
| project.filterEmpty | پروژه‌ای با این فیلترها پیدا نشد. | Für diese Filter wurden keine Projekte gefunden. | No projects match these filters. |
| filters.clear | پاک‌کردن فیلترها | Filter zurücksetzen | Clear filters |
| update.title | اطلاع‌رسانی به مشتری | Kundenkommunikation | Client updates |
| update.next | اطلاع‌رسانی بعدی | Nächste Rückmeldung | Next client update |
| update.lastRecorded | آخرین اطلاع‌رسانی ثبت‌شده | Zuletzt erfasste Rückmeldung | Last recorded update |
| update.noneRecorded | هنوز اطلاع‌رسانی‌ای ثبت نشده است. | Noch keine Rückmeldung erfasst. | No update has been recorded yet. |
| update.unscheduled | زمان اطلاع‌رسانی بعدی تعیین نشده است. | Noch kein Termin für die nächste Rückmeldung. | No next update is scheduled. |
| update.schedule | تعیین زمان اطلاع‌رسانی | Rückmeldung planen | Schedule update |
| update.recordCommunication | ثبت ارتباط انجام‌شده | Kommunikation erfassen | Record communication |
| update.contact | مخاطب | Kontaktperson | Contact |
| update.contactRole | نقش مخاطب | Rolle der Kontaktperson | Contact role |
| update.channel | روش ارتباط | Kommunikationskanal | Communication channel |
| update.cadence | فاصلهٔ اطلاع‌رسانی‌ها | Rhythmus der Rückmeldungen | Update cadence |
| update.occurredAt | زمان ارتباط | Zeitpunkt der Kommunikation | Communication time |
| update.snooze | تغییر زمان پیگیری | Nachverfolgung verschieben | Reschedule follow-up |
| update.overdue | از موعد گذشته | Überfällig | Overdue |
| assignment.title | هماهنگی کارها | Produktionsaufträge | Assignments |
| assignment.create | تعریف کار | Auftrag anlegen | Create assignment |
| assignment.edit | ویرایش کار | Auftrag bearbeiten | Edit assignment |
| assignment.name | عنوان کار | Auftragsbezeichnung | Assignment name |
| assignment.freelancer | همکار آزاد | Freie Fachkraft | Freelancer contact |
| assignment.brief | شرح کار | Aufgabenbeschreibung | Brief |
| assignment.blocker | مانع پیشرفت | Hindernis | Blocker |
| assignment.waitingOn | در انتظارِ | Wartet auf | Waiting on |
| assignment.empty | هنوز کاری تعریف نشده است. | Noch keine Aufträge angelegt. | No assignments yet. |
| assignment.awaitingAcceptance | در انتظار پذیرش | Zusage ausstehend | Awaiting acceptance |
| assignment.working | در حال انجام | In Bearbeitung | Working |
| assignment.submitted | تحویل برای بررسی ثبت شده | Abgabe erfasst | Submission recorded |
| assignment.internalReview | بررسی داخلی | Interne Prüfung | Internal review |
| assignment.changesRequested | نیازمند اصلاح | Änderungen angefordert | Changes requested |
| assignment.approved | تأیید داخلی | Intern freigegeben | Internally approved |
| assignment.canceled | لغوشده | Abgebrochen | Canceled |
| assignment.recordAcceptance | ثبت پذیرش همکار آزاد | Zusage der freien Fachkraft erfassen | Record freelancer acceptance |
| assignment.acceptanceRecorded | پذیرش، ثبت‌شده توسط {staffName} | Zusage, erfasst von {staffName} | Acceptance recorded by {staffName} |
| assignment.recordSubmission | ثبت نسخهٔ تحویل‌شده | Abgabe erfassen | Record submission |
| assignment.lastSubmittedVersion | آخرین نسخهٔ تحویل‌شده | Zuletzt abgegebene Version | Last submitted version |
| assignment.noSubmission | هنوز نسخه‌ای برای بررسی ثبت نشده است. | Noch keine Version zur Prüfung erfasst. | No version has been submitted for review. |
| validation.submittedVersion | مرجع نسخهٔ تحویل‌شده را وارد کنید. | Geben Sie die Referenz der abgegebenen Version an. | Enter the submitted version reference. |
| review.title | بازخورد و بازبینی | Feedback und Korrekturen | Feedback and revisions |
| review.addFeedback | ثبت بازخورد | Feedback erfassen | Record feedback |
| review.empty | هنوز بازخوردی ثبت نشده است. | Noch kein Feedback erfasst. | No feedback recorded yet. |
| review.version | نسخهٔ بررسی‌شده | Geprüfte Version | Reviewed version |
| review.round | دور بازبینی | Korrekturrunde | Revision round |
| review.includedUnknown | تعداد دورهای توافق‌شده مشخص نیست. | Die vereinbarte Anzahl an Korrekturrunden ist unbekannt. | The agreed number of revision rounds is unknown. |
| review.noneIncluded | تعداد دورهای بازبینیِ مورد توافق: صفر | Vereinbarte Korrekturrunden: keine | Included revision rounds: zero |
| review.extraScope | اصلاحات پیشنهادی خارج از محدودهٔ توافق | Vorgeschlagene Änderung außerhalb des vereinbarten Umfangs | Proposed change outside agreed scope |
| review.recordClientApproval | ثبت تأیید اعلام‌شدهٔ مشتری | Mitgeteilte Kundenfreigabe erfassen | Record reported client approval |
| review.clientApprovalRecorded | تأیید مشتری، ثبت‌شده توسط {staffName} | Kundenfreigabe, erfasst von {staffName} | Client approval recorded by {staffName} |
| review.internalApproval | تأیید داخلی برای نسخهٔ {version} | Interne Freigabe für Version {version} | Internal approval for version {version} |
| review.approveInternally | ثبت تأیید داخلی | Intern freigeben | Record internal approval |
| review.requestChanges | درخواست اصلاح | Änderungen anfordern | Request changes |
| review.newVersion | این نسخه به بررسی تازه نیاز دارد. | Diese Version muss erneut geprüft werden. | This version needs a new review. |
| review.evidence | مرجع تأیید یا مکاتبه | Referenz zum Nachweis oder zur Kommunikation | Evidence or communication reference |
| common.loading | در حال بارگذاری… | Wird geladen… | Loading… |
| common.loadFailed | بارگذاری این بخش انجام نشد. دوباره تلاش کنید. | Dieser Bereich konnte nicht geladen werden. Versuchen Sie es erneut. | This section could not be loaded. Try again. |
| common.retryLoad | تلاش دوباره برای بارگذاری | Erneut laden | Retry loading |
| common.retrySave | تلاش دوباره برای ذخیره | Speichern erneut versuchen | Retry saving |
| common.save | ذخیره تغییرات | Änderungen speichern | Save changes |
| common.saving | در حال ذخیره… | Wird gespeichert… | Saving… |
| common.saved | تغییرات ذخیره شد. | Änderungen gespeichert. | Changes saved. |
| common.saveFailed | تغییرات ذخیره نشد. اطلاعات واردشده در این پنجره حفظ شده است. | Die Änderungen wurden nicht gespeichert. Ihre Eingaben bleiben in diesem Fenster erhalten. | Changes were not saved. Your entries are retained in this editor. |
| common.saveUnknown | نتیجهٔ ذخیره مشخص نیست. پیش از تلاش دوباره، وضعیت را بررسی کنید. | Ob die Änderung gespeichert wurde, ist noch unklar. Prüfen Sie zuerst den aktuellen Stand. | Save status is unknown. Check the current record before trying again. |
| common.checkStatus | بررسی وضعیت فعلی | Aktuellen Stand prüfen | Check current status |
| common.conflict | این مورد هم‌زمان تغییر کرده است. نسخهٔ جدید را بررسی کنید؛ اطلاعات واردشدهٔ شما حفظ شده است. | Dieser Eintrag wurde inzwischen geändert. Prüfen Sie die aktuelle Version; Ihre Eingaben bleiben erhalten. | This record changed while you were editing. Review the latest version; your entries are retained. |
| common.reviewLatest | بررسی نسخهٔ جدید | Aktuelle Version prüfen | Review latest version |
| common.keepEditing | ادامهٔ ویرایش | Weiter bearbeiten | Keep editing |
| common.discard | کنارگذاشتن تغییرات | Änderungen verwerfen | Discard changes |
| common.discardQuestion | تغییرات ذخیره‌نشده کنار گذاشته شود؟ | Ungespeicherte Änderungen verwerfen? | Discard unsaved changes? |
| common.readOnly | شما فقط می‌توانید این پروژه را مشاهده کنید. | Sie können dieses Projekt nur ansehen. | You can view this project only. |
| common.unavailable | این مورد در دسترس نیست. | Dieser Eintrag ist nicht verfügbar. | This record is unavailable. |
| module.unavailable | هماهنگی پروژه‌ها در حال حاضر در دسترس نیست. | Die Projektkoordination ist derzeit nicht verfügbar. | Project coordination is currently unavailable. |
| module.returnToCrm | بازگشت به مدیریت ارتباط با مشتری | Zurück zum CRM | Return to CRM |
| validation.owner | یک مسئول داخلی انتخاب کنید. | Wählen Sie eine intern verantwortliche Person. | Select an internal owner. |
| validation.freelancer | یک همکار آزاد انتخاب کنید. | Wählen Sie eine freie Fachkraft. | Select a freelancer contact. |
| validation.reason | دلیل این تغییر را وارد کنید. | Geben Sie einen Grund für diese Änderung an. | Enter a reason for this change. |
| validation.evidence | مرجع پذیرش یا تأیید را وارد کنید. | Geben Sie eine Referenz zur Zusage oder Freigabe an. | Enter an acceptance or approval reference. |
| communication.draft | پیش‌نویس | Entwurf | Draft |
| communication.copied | متن کپی شد. | Text kopiert. | Text copied. |
| communication.staffRecorded | ارتباط، ثبت‌شده توسط {staffName} | Kommunikation, erfasst von {staffName} | Communication recorded by {staffName} |

Do not add a generic sent badge to the commitment or review record. Qualified MAIL facts, if later available, use their own accepted/partial/unknown/delivered/replied vocabulary and attempt bindings. Preparing or copying a draft never changes the staff-recorded log automatically. Approval copy always appears with the exact version and recording method; do not add a client avatar, signature treatment or authenticated-client checkmark without actual evidence.

## Responsive, direction and accessibility requirements

At 390px, headings/actions stack in the adopted shell layout, filters wrap, list summaries use one column and the editor remains within viewport height with a scrollable body and reachable actions. Long German field labels and recovery text wrap without clipping controls. Do not shrink authored names to make actions fit. At desktop, present summaries in the same semantic order; no visual-only column order that reverses keyboard reading.

Use logical spacing, alignment and borders. Preserve inherited Radix direction in portals; isolate names, addresses, URL references and version strings with appropriate `bdi`/local direction. Do not reverse email addresses, phone values, IDs or authored names. Mirror directional icons only through the current opt-in policy; status/check/calendar icons retain their meaning. Keep all labels and errors textual, not color-only. Match contrast/focus tokens in both themes, and honor reduced motion.

Language changes relabel the current draft without changing selected contacts, owners, canonical dates, timezone, digits, country, currency/unit or raw text. Civil dates remain civil dates. Scheduled instants show the chosen zone where needed for a decision, and require the actual Calendar ambiguity/DST handling. Neither Farsi nor German selects a workweek, holiday set or timezone automatically.

Use one page h1, semantic section headings, real buttons and adapter labels naming the field/action. Announce a completed save or error once in an appropriate live region; do not announce every polling refresh. Preserve focus while data updates. At 200% zoom, required content and actions remain reachable without two-direction scrolling. External references render as bounded plain text or safe allowed links with no automatic preview fetch, upload, public grant or hosted asset surface.

## Replay and telemetry protection

1 November source amendment, audited against Agency `3e84bc14c60cd3abb7c6340ba2022e6aa0dc3af2`. This adds implementation and qualification requirements; no Agency UI or telemetry behavior is enabled by the amendment.

The existing `src/features/observability/replayMasking.ts` exports `MASK_CLASS` (`ph-mask-email`) and `BLOCK_CLASS` (`ph-block-email`). Its recording configuration has `maskAllInputs: false`. `TelemetryProvider.tsx` enables autocapture and navigation pageviews, so sensitive Agency content needs deliberate exclusion. Follow the actual email surfaces: `src/features/email/MessageBodyFrame.tsx` blocks the sensitive container with `BLOCK_CLASS`; `composer/RichTextBody.tsx` pairs masking with `ph-no-capture`.

Use the existing `BLOCK_CLASS` on protected Agency containers and `ph-no-capture` to exclude their interactions from autocapture. Cover authored project/client context, briefs, notes, reasons, feedback, agreement/source text, evidence/version references, contact/address details, rates, costs and margins. Apply markers at actual rendered boundaries, including dialog, Sheet, Popover and portal content; a parent outside the portal does not establish descendant coverage. Use `MASK_CLASS` only where its narrower text masking is deliberately sufficient. These markers affect telemetry capture, not native labels, keyboard access, text readability or permissions.

Do not send protected values as telemetry properties, query/path strings, exception messages or console output. The generic scrubber is not the protection boundary: `scrub.ts` permits `reason` and `$` properties, only removes emails from message/error strings, and does not comprehensively remove financial values or nested payloads. Use shape-only failure telemetry following `resultSeam.ts`: registered error ID, fixed surface and pathname without authored/private query values. Preserve existing native employee identification and `next.config.ts` server-function argument logging disabled; introduce no client identity, external actor identification or raw form logging.

Before enabling UI, qualify marker coverage on actual rendered editable/read-only/history/error states and all portaled surfaces in FA/DE/EN. Verify actual browser replay/autocapture behavior with synthetic protected content and an isolated inspected capture boundary; a marker string or passing catalog test alone is not capture evidence. Record that result separately from source review and from any live-provider qualification. Current project/financial authority and Privacy field-disclosure checks remain mandatory even when telemetry markers are present.

## Required design verification and open decisions

This proposal supplies states and draft copy only. AP-01 acceptance still requires the accepted combined shell, implemented catalogs/ICU parity, actual native-language feedback or an explicit pending record, and rendered/native evidence on the exact candidate. Use the modeling assignment, short-video revision and multi-contact client scenarios; record design hypotheses separately from participant observations.

Required captures/checks cover every state above in FA/DE/EN, light/dark, desktop/390px, 200% zoom, mixed-script names, long German, keyboard/RTL navigation, Dialog focus trap/Escape/return focus and save/retry/conflict/reload behavior. Repeat with independently chosen Persian/Gregorian calendar, numbering and timezone. Permission loss must clear stale projections; unknown saves must reconcile without duplicate records/effects. A catalog render alone does not prove persistence or denial behavior.

Open decisions before production UI: combined qualification of the adopted Settings/Sales refs; server project/financial authority and disabled-module history policy; Calendar visibility/state/date/reminder seam; final list ordering/page cap and saved views; actual request-status recovery API; safe local draft lifetime/privacy inventory; deliverable-version reopening and review provenance; native Farsi/German terminology review. Finance panels, template activation, provider sending and client/freelancer portals are not substituted into this first workspace.
