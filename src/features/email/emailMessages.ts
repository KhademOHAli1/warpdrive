import { createTranslator } from "next-intl";
import type { INBOX_STRINGS } from "@/constants/inboxStrings";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import type { COMPOSER_STRINGS } from "./composer/composer.constants";
import argumentsByPath from "./emailMessageParams.json";
import english from "./messages/email.en.json";
import persian from "./messages/email.fa.json";

type Localized<Value, Path extends string = ""> = Value extends (...args: infer Args) => unknown
  ? (...args: Args) => string
  : Path extends keyof typeof argumentsByPath
    ? (...args: (string | number)[]) => string
    : Value extends string
      ? string
      : {
          [Key in keyof Value]: Localized<
            Value[Key],
            Path extends "" ? Key & string : `${Path}.${Key & string}`
          >;
        };
type Source = Omit<typeof english, keyof typeof INBOX_STRINGS | "_composer"> &
  typeof INBOX_STRINGS & {
    _composer: Omit<typeof COMPOSER_STRINGS, "defaultActivitySubject" | "emailActivityTypeKey">;
  };
export type EmailMessages = Localized<Source>;
export function emailMessagesForLocale(
  locale: Locale,
  numberingSystem?: NumberingSystem,
): EmailMessages {
  const translate = createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: locale === "fa" ? persian : english,
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const parameters: Record<string, string[]> = argumentsByPath;
  function build(value: unknown, path: string): unknown {
    const names = parameters[path];
    if (names !== undefined)
      return (...args: (string | number)[]) =>
        translate(path, Object.fromEntries(names.map((name, index) => [name, args[index] ?? ""])));
    if (typeof value === "string") return translate(path);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        build(item, path === "" ? key : `${path}.${key}`),
      ]),
    );
  }
  return build(english, "") as EmailMessages;
}
