# UX-005: راهنمای واژگان فارسی

Review date: 2026-10-31. Inspected source head: `45b722b51cb8bfa39aa6da56d13982dbbd58e44c`.
Evidence class: source-based terminology decisions and reviewed localization design. This document
does not change catalogs, routes, permissions or task status. Root source/design review completed
on 2026-10-31; its requested explicit no-send guard is applied below. No rendered/browser,
native-speaker usability, accessibility or live-provider qualification was performed.

Exact UX-005 acceptance: “Standardize CRM, pipeline, connection, permission, workflow and calendar
terms with contextual examples.” The active 446-task register remains the scope. UX-001 is the
recorded dependency; later peer scope proposals are not adopted by this glossary.

## واژه‌های پایه و کاربرد آن‌ها

واژه را بر اساس کاری انتخاب کنید که کاربر انجام می‌دهد. نام محصول و شناسهٔ فنی را تغییر ندهید.
متن کوتاه دکمه باید عمل را روشن کند؛ توضیح کنار آن باید دامنه و پیامد همان عمل را بگوید.
این جدول مرجع متن‌های تازه و بازبینی‌های بعدی است، نه ادعای یکدست شدن همهٔ متن‌های موجود.

| مفهوم                          | فارسی معیار                           | Deutsch                                                         | English                                    | نمونهٔ کاربرد و مرز معنا                                                                                                                                |
| ------------------------------ | ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CRM                            | مدیریت ارتباط با مشتری (CRM)، سپس CRM | Kundenbeziehungsmanagement (CRM)                                | Customer relationship management (CRM)     | «اطلاعات مشتری را در CRM پیدا کنید.» نام سامانه را با یک حساب یا فضای کاری بیرونی یکی نگیرید.                                                           |
| Pipeline                       | مسیر فروش                             | Vertriebspipeline                                               | Sales pipeline                             | «فرصت فروش را به مسیر فروش دیگری منتقل کنید.» در متن رابط از جابه‌جایی میان «قیف فروش»، «پایپ‌لاین» و «مسیر فروش» برای یک موجودیت پرهیز کنید.             |
| Deal                           | فرصت فروش                             | Verkaufschance                                                  | Deal / sales opportunity                   | «عنوان فرصت فروش را وارد کنید.» فرصت هنوز الزاماً به فروش یا قرارداد نرسیده است؛ «معاملهٔ انجام‌شده» معادل آن نیست.                                       |
| Pipeline stage                 | مرحلهٔ مسیر فروش                       | Pipeline-Phase                                                  | Pipeline stage                             | «مرحلهٔ بعدی مسیر فروش را انتخاب کنید.» در کنار مرحله‌های گردش‌کار، قید «مسیر فروش» را بیاورید.                                                           |
| Lead                           | سرنخ                                  | Lead                                                            | Lead                                       | «سرنخ را به فرصت فروش تبدیل کنید.» تبدیل موجودیت را با ایجاد مشتری قطعی یکی نگیرید.                                                                    |
| Activity                       | فعالیت                                | Aktivität                                                       | Activity                                   | «یک فعالیت پیگیری اضافه کنید.» فعالیت می‌تواند تماس، جلسه یا کار باشد؛ همهٔ فعالیت‌ها رویداد بیرونی نیستند.                                               |
| Connection                     | اتصال                                 | Verbindung                                                      | Connection                                 | «اتصال Gmail خود را مدیریت کنید.» این رابطهٔ حساب/سرویس با CRM است؛ ارتباط بین دو مرحلهٔ گردش‌کار یا اتصال پایگاه داده معنای دیگری دارد.                  |
| Connect / reconnect            | اتصال حساب / اتصال دوباره             | Konto verbinden / erneut verbinden                              | Connect account / reconnect                | «همان حساب را دوباره متصل کنید.» اتصال دوباره به‌خودی‌خود اجازهٔ جایگزینی هویت حساب را نمی‌دهد.                                                            |
| Personal / shared connection   | اتصال شخصی / اتصال مشترک              | Persönliche / gemeinsam genutzte Verbindung                     | Personal / shared connection               | «این اتصال مشترک فضای کاری است.» مشترک بودن ابزار به معنای قابل‌خواندن شدن محتوای شخصی برای مدیر نیست.                                                  |
| Access                         | دسترسی                                | Zugriff                                                         | Access                                     | «به این اطلاعات دسترسی ندارید.» نتیجه یا دامنهٔ استفاده را بیان می‌کند؛ جایگزین نام یک مجوز مشخص نیست.                                                    |
| Permission                     | مجوز                                  | Berechtigung                                                    | Permission                                 | «مجوز خواندن مخاطبان را بررسی کنید.» عمل و منبع را نام ببرید؛ داشتن مجوز خواندن، مجوز تغییر یا ارسال نیست.                                             |
| Grant / revoke                 | اعطای مجوز / لغو دسترسی               | Berechtigung erteilen / Zugriff widerrufen                      | Grant / revoke access                      | «دسترسی این دستیار را لغو کنید.» لغو دسترسی محلی و تأیید لغو در سرویس بیرونی دو نتیجهٔ جدا هستند.                                                       |
| Upstream OAuth scope           | دامنهٔ دسترسی در سرویس بیرونی          | OAuth-Berechtigungsumfang beim Anbieter                         | Upstream OAuth scope                       | «دسترسی‌های درخواستی Google را بررسی کنید.» دامنهٔ OAuth را مجوز نقش کاربر در CRM معرفی نکنید؛ در راهنمای فنی می‌توان `scope` را در پرانتز آورد.          |
| Authentication                 | تأیید هویت                            | Authentifizierung                                               | Authentication                             | «برای تأیید این تغییر، دوباره وارد حساب شوید.» ورود یا تأیید هویت، مجوز انجام هر عملیات را ایجاد نمی‌کند.                                               |
| Authorization / consent review | بررسی و تأیید مجوزها                  | Berechtigungen prüfen und erteilen                              | Review and authorize access                | «حساب، منابع و مجوزهای درخواستی را بررسی کنید.» تأیید مجوز با تأیید هویت تفاوت دارد.                                                                   |
| Workflow                       | گردش‌کار                               | Workflow                                                        | Workflow                                   | «یک گردش‌کار ایجاد کنید.» برای همان موجودیت از «جریان کاری»، «سناریو» و «اتوماسیون» به‌جای نام ثابت استفاده نکنید. «خودکارسازی» نام حوزه یا قابلیت است.  |
| Workflow step / node           | مرحلهٔ گردش‌کار                         | Workflow-Schritt                                                | Workflow step                              | «مرحلهٔ قبلی گردش‌کار را انتخاب کنید.» در راهنمای فنیِ نمودار می‌توان «گره» گفت؛ نام فیلد کاربرمحور «نام مرحله» می‌ماند.                                    |
| Trigger / condition / action   | آغازگر / شرط / عملیات                 | Auslöser / Bedingung / Aktion                                   | Trigger / condition / action               | «هنگام شروع، یک فرصت فروش انتخاب کنید.» برای نوع رویدادمحورِ آینده، «رویداد آغازگر» روشن‌تر است. آغاز گردش‌کار با اجازه یا موفقیت عملیات یکی نیست.        |
| Draft / publish / run          | پیش‌نویس / انتشار / اجرا               | Entwurf / veröffentlichen / ausführen                           | Draft / publish / run                      | «پیش‌نویس ذخیره شد.» ذخیره، انتشار و اجرای گردش‌کار سه عمل جدا هستند؛ انتشار نیز مجوز تازه‌ای به کاربر نمی‌دهد.                                            |
| Calendar                       | تقویم                                 | Kalender                                                        | Calendar                                   | «نوع تقویم را انتخاب کنید.» تقویم نمای فعالیت‌ها، نوع تقویم تاریخ و اتصال تقویم بیرونی را با قید مناسب مشخص کنید.                                       |
| Iranian / Gregorian calendar   | هجری شمسی (ایران) / میلادی             | Iranischer Kalender (Solar-Hidschri) / gregorianischer Kalender | Iranian (Solar Hijri) / Gregorian calendar | «زبان فارسی و تقویم میلادی را انتخاب کنید.» «فارسی» نام زبان است؛ هجری شمسی را با هجری قمری یکی نگیرید. مقادیر فنی `persian` و `gregory` تغییر نمی‌کنند. |
| Event / domain event           | رویداد تقویم / رویداد سامانه          | Kalendertermin / Systemereignis                                 | Calendar event / domain event              | «رویداد تقویم را ویرایش کنید.» در تاریخچهٔ خودکارسازی بنویسید «رویداد تغییر فرصت فروش»؛ رویداد سامانه دعوت‌نامهٔ جلسه نیست.                               |
| All-day / timed                | تمام روز / دارای ساعت مشخص            | Ganztägig / mit Uhrzeit                                         | All-day / timed                            | برچسب فعلی «تمام روز» است؛ در جمله «رویداد تمام‌روز» بنویسید. ساعت `00:00` اگر عمداً انتخاب شده باشد یک زمان مشخص است.                                   |
| Time zone / UTC offset         | منطقهٔ زمانی / اختلاف با UTC            | Zeitzone / UTC-Abweichung                                       | Time zone / UTC offset                     | «منطقهٔ زمانی: Europe/Berlin، UTC+02:00». نام منطقه و اختلاف همان تاریخ را یکی نگیرید.                                                                   |
| Recurrence / occurrence        | تکرار / نوبت رویداد                   | Wiederholung / einzelner Termin einer Serie                     | Recurrence / occurrence                    | «فقط این نوبت یا کل مجموعه؟» این نمونه برای طراحی آینده است؛ ویرایش مجموعهٔ تکرارشونده در مدل فعلی فعالیت‌ها پیاده نشده است.                             |

## جمله‌هایی که سطح اطمینان را روشن می‌کنند

این نمونه‌ها لحن و مرز معنا را تثبیت می‌کنند. نمایش هر وضعیت باید به داده و رفتار همان قابلیت
متکی باشد؛ وجود متن در این راهنما به معنای وجود آن وضعیت در برنامه نیست.

| موقعیت                           | فارسی                                                                           | Deutsch                                                                                  | English                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| حساب ذخیره‌شده، بدون ادعای سلامت   | «۵ اتصال ثبت شده است.»                                                          | „5 gespeicherte Verbindungen.“                                                           | “5 saved connections.”                                                             |
| موفقیت همان آزمون دسترسی         | «بررسی دسترسی موفق بود.»                                                        | „Zugriffsprüfung erfolgreich.“                                                           | “Access check passed.”                                                             |
| پیش‌نویس بدون ارسال               | «پیش‌نویس ذخیره شد؛ پیامی ارسال نشد.»                                            | „Entwurf gespeichert; keine Nachricht gesendet.“                                         | “Draft saved; no message was sent.”                                                |
| توقف محلی و نتیجهٔ بیرونیِ نامعلوم | «دسترسی این اتصال در CRM قطع شده است؛ لغو دسترسی در Slack هنوز تأیید نشده است.» | „Diese Verbindung ist im CRM gesperrt; der Widerruf bei Slack ist noch nicht bestätigt.“ | “This connection is blocked in the CRM; revocation in Slack is not confirmed yet.” |
| زمان نامعتبر بر اثر تغییر ساعت   | «این ساعت در منطقهٔ زمانی انتخاب‌شده وجود ندارد. ساعت دیگری انتخاب کنید.»         | „Diese Uhrzeit gibt es in der gewählten Zeitzone nicht. Wählen Sie eine andere Uhrzeit.“ | “This time does not exist in the selected time zone. Choose another time.”         |
| قابلیت آینده                     | «نصب برنامه از بازارچه در این نسخه در دسترس نیست.»                              | „Apps können in dieser Version noch nicht über den Marktplatz installiert werden.“       | “Marketplace app installation is not available in this version.”                   |

نمونهٔ «پیش‌نویس ذخیره شد؛ پیامی ارسال نشد» فقط وقتی مجاز است که هیچ تلاش ارسالی آغاز نشده و
هیچ اثر بیرونیِ احتمالی وجود نداشته باشد. ذخیره شدن پیش‌نویس به‌تنهایی این شرط را ثابت نمی‌کند.
اگر درخواست ممکن است به سرویس بیرونی رسیده باشد، نتیجهٔ واقعیِ در انتظار یا نامعلوم را توضیح دهید؛
عبارت «ارسال نشد» را نمایش ندهید.

«متصل»، «مجوز داده شده»، «تنظیم‌شده»، «بررسی‌شده» و «آزموده‌شده با حساب واقعی» مترادف نیستند.
برای دستیار فعلی MCP، دسترسی را بر اساس نقش موجود کاربر توضیح دهید؛ متن «فقط‌خواندنی» فقط زمانی
مجاز است که آن محدودیت واقعاً اعمال شود. نتیجهٔ آزمون اتصال نیز رسید تحویل پیام نیست.

## نگارش و نگهداری

- از نیم‌فاصله در «گردش‌کار»، «پیش‌نویس»، «به‌روزرسانی» و جمع‌های مناسب استفاده کنید. «مسیر فروش»
  و «فرصت فروش» دو ترکیب ثابت‌اند. جملهٔ خطا باید بگوید چه کاری انجام نشد و قدم بعدی چیست.
- نام‌هایی مانند Gmail، Slack، Google Calendar و Warpdrive ترجمه نمی‌شوند. نشانی، شناسه، نام
  منطقهٔ زمانی و کد مجوز را به ارقام فارسی تبدیل نکنید. جداسازی جهت متن باید در جزء نمایشی
  انجام شود؛ فاصله یا کاراکتر جهت مخفی را داخل مقدار ذخیره‌شده اضافه نکنید.
- ترجمهٔ شمارش باید از پیام دارای متغیر و قالب‌بندی ترجیح کاربر بیاید؛ عدد و پسوند را به هم
  نچسبانید. زبان فارسی الزام به رقم فارسی یا تقویم هجری شمسی ایجاد نمی‌کند.
- در بازبینی واژه، مفهوم، بافت، کلید پیام، نمونهٔ فارسی و معادل DE/EN را با هم تغییر دهید.
  نام کلید API، شناسهٔ پایدار ارائه‌دهنده و دادهٔ نوشته‌شدهٔ کاربر ترجمه نمی‌شوند.

## تطبیق با منبع و موارد باز

| منبع موجود                                                                                                                                                 | تصمیم یا محدودیت                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/i18n/messages/fa.json`, `nav` و `preferences`                                                                                                | «گردش‌کارها»، «فرصت‌های فروش»، «هجری شمسی (ایران)» و «میلادی» مبنا هستند. عنوان کوتاه ناوبری «فروش» جای نام دقیق موجودیت در فرم را نمی‌گیرد.                                                                                                                                                                                                                |
| `src/features/deals/messages/sales.fa.json`, `pipeline_37e1c`, `pipeline_stage_8e0c5`, `deal_ae642`؛ `src/features/identity/messages/settings.fa.json:118` | «مسیر فروش»، «مرحلهٔ مسیر فروش» و «فرصت فروش» با واژگان اصلی سازگارند.                                                                                                                                                                                                                                                                                   |
| `src/features/workflows/messages/workflows.fa.json:68`, `:112`, `:113`                                                                                     | «مرحله معامله»، «عنوان معامله از مرحله قبل» و «یک معامله انتخاب می‌کنید» هنوز با «فرصت فروش» همسان نیستند. پیشنهاد بازبینی بعدی: «مرحلهٔ مسیر فروش»، «عنوان فرصت فروش از مرحلهٔ قبل» و «یک فرصت فروش انتخاب می‌کنید». راهنمای آغازگر فعلی صریحاً شروع دستی را توضیح می‌دهد؛ نام گردش‌کار، خودکار بودن آغاز آن را ثابت نمی‌کند. هیچ کلیدی در این کار ویرایش نشد. |
| همان فایل، `title`, `stepName`, `draft`, `publish`, `status`                                                                                               | نام گردش‌کار، مرحله، پیش‌نویس، انتشار و وضعیت اجرا از هم جدا می‌مانند. وضعیت موفقِ اجرا به‌تنهایی اثبات تحویل بیرونی نیست.                                                                                                                                                                                                                                   |
| `src/features/integrations/messages/integrations.fa.json`, `access`, `currentGrant`, `checked`, `disconnectBody`, `savedConnections`                       | واژه‌های اتصال/دسترسی/مجوز، آزمون محدود و پیامد قطع اتصال باید همان تفکیک واقعی را حفظ کنند.                                                                                                                                                                                                                                                             |
| همان فایل، `marketplace` و `marketBody`                                                                                                                    | «بازارچهٔ برنامه‌ها» و «بازار افزونه‌ها» اکنون هر دو وجود دارند. برای متن تازه «بازارچهٔ برنامه‌ها» مرجع است؛ یکدست‌سازی بعدی نباید نصب را موجود جلوه دهد.                                                                                                                                                                                                    |
| `src/features/i18n/messages/fa.json`, `preferences.englishNumbers`                                                                                         | متن فعلی «اعداد انگلیسی» است. در توضیح دقیق‌تر می‌توان «ارقام لاتین (123)» نوشت؛ این ترجیح، زبان رابط را تغییر نمی‌دهد.                                                                                                                                                                                                                                     |
| `src/features/activities/messages/calendar.fa.json:10`, `:19`, `:32`                                                                                       | نوع تقویم، «تمام روز» و منطقهٔ زمانی مبنای تقویم‌اند. سناریوهای زمان و محدودیت تکرار در [regional-date-scenarios.md](regional-date-scenarios.md) مشخص شده‌اند.                                                                                                                                                                                             |

Acceptance handoff: the six named UX-005 domains have standard FA terms, contextual rules and
DE/EN mappings above. Remaining catalog inconsistencies are identified rather than silently
changed. Root reviewed this design evidence with the correction recorded above; task-status
changes belong to the register owner. Rendered fit, native-speaker usability and later
implementation tasks require their own evidence.

## Later digit-choice implementation

The restrictions recorded above describe the reviewed earlier source. The later
[numbering correction](numbering-qualification-20261101.md), application 7c8bb7e, now
honors an explicit Persian or Latin digit choice across FA/DE/EN Settings and pickers.
It preserves absent-choice defaults, selected calendar/zone and raw values. Its unit,
static and compile evidence does not replace browser/native-speaker/recurrence acceptance.
Week-start coupling and other untouched limitations retain their separate scope.
