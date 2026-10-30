# Iranian Persian terminology

Use the same product concept consistently across navigation, forms, validation, notifications and
accessibility text. Translate meaning and the action the user needs to take; retain machine IDs,
stored enum values, brands and user-entered records.

| English concept          | Iranian Persian          |
| ------------------------ | ------------------------ |
| deal / deals             | فرصت فروش / فرصت‌های فروش |
| lead / leads             | سرنخ / سرنخ‌ها            |
| pipeline                 | مسیر فروش                |
| sales funnel (analytics) | قیف فروش                 |
| stage                    | مرحله                    |
| won / lost               | موفق / ناموفق            |
| person / people          | فرد / افراد              |
| contact / contacts       | مخاطب / مخاطبان          |
| organization             | سازمان                   |
| activity                 | فعالیت                   |
| owner (assigned user)    | مسئول                    |
| archive / archived       | بایگانی / بایگانی‌شده     |
| save                     | ذخیره                    |
| cancel                   | انصراف                   |
| delete                   | حذف                      |
| settings                 | تنظیمات                  |
| sign in / sign out       | ورود / خروج از حساب      |
| Solar Hijri calendar     | تقویم هجری شمسی          |
| Gregorian calendar       | تقویم میلادی              |

Pluralize whole phrases naturally. Avoid mechanically attaching Persian plural endings to Latin
brands or transliterating ordinary commands. Use Persian yeh/kaf and appropriate half-spaces;
isolate Latin product names, URLs, email addresses and identifiers in RTL text. Keep screen-reader
names as natural sentences instead of copying awkward upstream ordinals.

The catalog audit rejects copied English literal text. A deliberately invariant name must be
reviewed and listed, by catalog group, locale and key, in
`scripts/i18n/translation-exceptions.json`, with a reason. This is for names and technical notation,
not a waiver for untranslated sentences. Native-language editorial and workflow review remains
part of acceptance after the catalog migration.

## German terminology and voice

Use concise professional German. Prefer neutral interface phrases; address the user with
**Sie/Ihr** when direct address is needed. Translate the task and consequence as a whole,
including plurals, validation, destructive confirmations and screen-reader names.

| English concept                  | German                                  |
| -------------------------------- | --------------------------------------- |
| deal / deals                     | Verkaufschance / Verkaufschancen        |
| lead / leads                     | Lead / Leads                            |
| pipeline                         | Vertriebspipeline                       |
| stage                            | Phase / Vertriebsphase                  |
| won / lost                       | Gewonnen / Verloren                     |
| person / organization            | Person / Organisation                   |
| owner (assigned user)            | Verantwortliche Person / Verantwortlich |
| assignee                         | Zugewiesen an                           |
| activity / note                  | Aktivität / Notiz                       |
| follow / unfollow a record       | Folgen / Nicht mehr folgen              |
| follow-up activity               | Folgeaktivität                          |
| contact timeline / audit history | Interaktionsverlauf / Änderungsverlauf  |
| expected close date              | Voraussichtliches Abschlussdatum        |
| enrichment                       | Datenanreicherung                       |
| fill the gaps                    | Fehlende Daten ergänzen                 |
| email / subject / body           | E-Mail / Betreff / Nachrichtentext      |
| inbox / drafts / outbox          | Posteingang / Entwürfe / Postausgang    |
| custom field                     | Benutzerdefiniertes Feld                |
| remove / delete                  | Entfernen / Löschen                     |
| Solar Hijri calendar             | Persischer Kalender (Solar-Hidschri)    |

Keep product names, authored record names, identifiers and provider payloads intact. Established
German UI terms such as Filter, Status, Name, Person, Label, Lead and Board may match English;
record each such catalog key with a specific reason in the translation exception file. Do not
replace natural German with awkward synonyms to satisfy a copied-English check.

German user drafts use decimal commas and grouping dots. Canonical database/API decimal
strings use a decimal dot. At editing boundaries, format canonical values for display and parse
an authored draft exactly once in its originating locale. Keep incomplete drafts and their locale
when the interface language changes. Never feed a stored decimal string back through the
German input parser or localize a provider, CSV or API payload.
