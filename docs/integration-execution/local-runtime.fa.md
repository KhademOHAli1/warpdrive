# راه‌اندازی پیش‌نمایش محلی برنامهٔ یکپارچه‌سازی

این راهنما برای محیط آزمایشی جداگانه‌ای است که در ۳۱ اکتبر ۲۰۲۶ بررسی شد. اجرای موفق
این محیط، فقط کارکرد محلی سرویس‌ها را نشان می‌دهد. حساب واقعی سرویس‌دهنده، ارسال پیام
بیرونی، دامنهٔ عمومی و انتشار محصول در این مرحله تأیید نشده‌اند. این راهنمای محدود، به‌معنای
تکمیل مستندات عملیاتی تمام برنامه یا تکمیل `OPS-017` نیست.

دستورهای اصلی و مولد تنظیمات در [راهنمای مشترک](local-runtime.md) نگهداری می‌شوند.
مقادیر نمونهٔ محرمانه را از نو در این فایل تعریف نکنید. دستورهای ترمینال، نشانی‌ها و شناسه‌ها
عمداً با حروف و ارقام ASCII نوشته شده‌اند؛ زبان رابط، نوع ارقام، تقویم و منطقهٔ زمانی مستقل‌اند.

## ابتدا محیط متعلق به این برنامه را تشخیص دهید

| سرویس                   | نشانی یا منبع                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------ |
| برنامه                  | `http://127.0.0.1:3160`                                                              |
| PostgreSQL 18 محلی      | `127.0.0.1:55436`، پایگاه `integration_program_preview`، کاربر `integration_program` |
| پردازشگر کارهای پس‌زمینه | فرایند جداگانهٔ `dist/worker.mjs`                                                     |
| سرویس بلادرنگ            | `ws://127.0.0.1:8080` با `WS_HOST=127.0.0.1`                                         |
| شبیه‌ساز S3              | `http://127.0.0.1:9160`، مخزن `integration-program`                                  |
| تنظیمات و دادهٔ خصوصی    | `/tmp/warpdrive-integration-program-private`                                         |

پورت‌های `3104`، `3105`، `3116`، `3150`، `5432`، `55432`، `55435` و `9000` در بررسی
اولیه به پیش‌نمایش‌ها یا سرویس‌های دیگر مربوط بودند. وضعیت زنده را دوباره بررسی کنید؛
برای آزادکردن پورت، فرایند دیگری را متوقف نکنید. پورت‌های موقت Testcontainers نیز به
آزمون‌های جداگانه تعلق دارند.

```sh
lsof -nP -iTCP:3160 -iTCP:55436 -iTCP:8080 -iTCP:9160 -sTCP:LISTEN
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/warpdrive-integration-program-private/postgres status
docker --context colima-warpdrive inspect --format '{{.State.Status}} {{index .Config.Labels "codex.owner"}}' warpdrive-integration-program-s3
```

نام، دستور اجرا، پوشهٔ کاری و پورت هر فرایند را تطبیق دهید. برچسب کانتینر باید
`warpdrive-integration-program` باشد. اگر سرویس متعلق به همین محیط از قبل روشن است،
نمونهٔ دوم آن را اجرا نکنید. ابزار PostgreSQL موجود در PATH سیستم به نسخهٔ قدیمی ۱۴ با
کتابخانهٔ ICU ناموجود اشاره می‌کرد؛ برای این محیط، مسیر صریح نسخهٔ ۱۸ را به‌کار ببرید.
ابزارهای سراسری را به‌روزرسانی نکنید.

## راه‌اندازی مجدد با تنظیمات موجود

این مسیر زمانی است که `runtime.env`، کلاستر PostgreSQL و کانتینر این محیط وجود دارند.
کلیدها را دوباره تولید نکنید و `initdb`، `createdb` یا `docker create` را تکرار نکنید.
فایل تنظیمات باید خصوصی بماند و نباید در خروجی ترمینال، Git یا گزارش عمومی کپی شود.

از پوشهٔ زیر یا نسخه‌ای که مستقلاً از بستهٔ منبع بازیابی شده است کار کنید:

```sh
cd /tmp/warpdrive-integrations-preview-20261031
export PATH=/tmp/warpdrive-bun144/bin:$PATH
bun --version
bun install --frozen-lockfile
bun run build:workers
```

نسخهٔ Bun باید دقیقاً `1.4.4` باشد. فایل قفل را تغییر ندهید. پوشهٔ Git اصلی در
`/tmp/warpdrive-integrations-20261031` را تا پیش از بازیابی مستقل و بررسی‌شده حذف نکنید.

فقط سرویس‌های متوقف‌شدهٔ همین محیط را با دستورهای زیر روشن کنید:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/warpdrive-integration-program-private/postgres -l /tmp/warpdrive-integration-program-private/postgres.log -o '-h 127.0.0.1 -p 55436 -k /tmp/warpdrive-integration-program-private' start
docker --context colima-warpdrive start warpdrive-integration-program-s3
```

سپس مهاجرت‌ها را روی همین پایگاه جداگانه اعمال کنید:

```sh
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/migrate.mjs
```

خروجی موفق باید به `migrations applied` برسد. نمایش راهنمای Bun به‌معنای اجرای مهاجرت
نیست. مهاجرت‌ها رو به جلو هستند؛ بازنشانی داده فقط برای همین محیط آزمایشی خالی مجاز است.

هر دستور زیر را در یک ترمینال جداگانه، با همان پوشهٔ کاری و PATH اجرا کنید:

```sh
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/worker.mjs
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/ws.mjs
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env --bun node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3160
```

اگر ساخت production لازم است، پیش از اجرای برنامهٔ توسعه آن را انجام دهید. هر دو از پوشهٔ
`.next` همین checkout استفاده می‌کنند. ابتدا فقط برنامهٔ توسعهٔ متعلق به این محیط را در
ترمینال خودش متوقف کنید و تنظیمات خصوصی مخصوص ساخت را طبق
[بخش آزمون و ساخت راهنمای مشترک](local-runtime.md#run-finite-qualification) به‌کار ببرید.
مقادیر ساخت، وجود سرویس واقعی TLS یا SMTP را ثابت نمی‌کنند. پیش‌نمایش با تنظیمات
development و ثبت محلی ایمیل‌های احراز هویت اجرا می‌شود.

## ساخت یک محیط آزمایشی کاملاً خالی

این کار با راه‌اندازی مجدد تفاوت دارد. فقط برای دادهٔ موقت و خالی، مراحل
[تولید تنظیمات خصوصی](local-runtime.md#recreate-private-configuration-on-a-fresh-profile)
و سپس [ساخت شبیه‌ساز S3](local-runtime.md#start-the-s3-simulator) را اجرا کنید.
مولد مشترک، در صورت وجود `runtime.env` متوقف می‌شود تا کلیدهای موجود را جایگزین نکند.
کلید جدید برای داده‌ای که با کلید قبلی رمز شده است نسازید.

در راهنمای مشترک، `initdb` و `createdb` فقط یک‌بار اجرا می‌شوند. احراز هویت `trust`
صرفاً به کلاستر موقت متصل به loopback محدود است و تنظیم مناسب production محسوب نمی‌شود.
پس از آماده‌سازی، مراحل نصب وابستگی‌ها، ساخت worker، مهاجرت و اجرای سرویس‌های بالا را
انجام دهید.

برای Docker از `--context colima-warpdrive` در تک‌تک دستورها استفاده کنید؛ context
سراسری را عوض نکنید. مسیر `/tmp` میزبان در ماشین مجازی اشتراکی نیست. بنابراین تنظیمات
کانتینر باید طبق دستور مشترک با `docker cp` منتقل شود، نه با bind mount نامعتبر.
نسخهٔ اصلی تنظیمات روی میزبان با سطح دسترسی `0600` باقی می‌ماند؛ کپی موقت قابل‌خواندن
برای کاربر کانتینر در پوشهٔ خصوصی ساخته و بلافاصله حذف می‌شود. image با digest مشخص
ثابت شده است. SeaweedFS در اینجا شبیه‌ساز سازگار با S3 است؛ این آزمون، رفتار MinIO در
production یا بارگذاری multipart در مرورگر را تأیید نمی‌کند.

## آزمون محدود سرویس‌ها و کنترل رد محیط اشتباه

آزمون smoke فقط برای محیط خالی با همین نشانی‌هاست. اگر دادهٔ کاربر، صندوق ایمیل، اتصال
سرویس‌دهنده، ایمیل احراز هویت یا درخواست لغو دسترسی وجود داشته باشد، پیش از نوشتن
دادهٔ آزمایشی متوقف می‌شود. برای عبور از این شرط، دادهٔ موجود را حذف نکنید.

```sh
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env scripts/integration-profile-smoke.ts
```

خروجی موفق `ok:true` و کد خروج `0` دارد. آزمون از worker واقعی و جداگانه، یک نشست
آزمایشی احراز هویت، WebSocket معتبر، `pg_notify` واقعی و یک شیء S3 استفاده می‌کند.
سپس کاربر، نشست، ticket و شیء آزمایشی را پاک می‌کند. رکورد کار تکمیل‌شدهٔ صف برای شواهد
باقی می‌ماند. این آزمون ورود کاربر در مرورگر، MFA یا هویت سرویس‌دهندهٔ واقعی را تأیید نمی‌کند.

برای بررسی محافظ محیط، تنها نشانی برنامه را در همین اجرای دستور تغییر دهید:

```sh
BASE_URL=http://127.0.0.1:3161 bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env scripts/integration-profile-smoke.ts
```

در این حالت، نتیجهٔ مورد انتظار `profile_refused_before_writes` و کد خروج `1` است.
نشانی ذخیره‌شده و سرویس‌های روشن تغییر نمی‌کنند. نتایج ثبت‌شده، هش منبع و شمارش مستقل
پاک‌سازی در [گزارش smoke](runtime-smoke.md) آمده‌اند. آزمون‌های PostgreSQL 16 مبتنی بر
Testcontainers از بررسی این محیط native PostgreSQL 18 جدا هستند؛ دستور دقیق آن‌ها در
راهنمای مشترک قرار دارد.

## توقف

برنامه، worker و سرویس بلادرنگ را در ترمینال متعلق به خودشان با `Ctrl-C` متوقف کنید.
پس از تطبیق مالکیت و نام منابع، برای توقف سرویس‌های زیر از همین دستورهای محدود استفاده کنید:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/warpdrive-integration-program-private/postgres stop -m fast
docker --context colima-warpdrive stop warpdrive-integration-program-s3
```

دستور عمومی برای کشتن همهٔ فرایندهای Bun یا PostgreSQL و پاک‌سازی سراسری Docker اجرا نکنید.
پوشهٔ داده، volume، تنظیمات و checkoutهای دیگر را حذف نکنید. آزمون زندهٔ سرویس‌دهنده، میزبانی
عمومی و انتشار، هرکدام منابع، مجوز و شواهد جداگانهٔ خود را لازم دارند.
