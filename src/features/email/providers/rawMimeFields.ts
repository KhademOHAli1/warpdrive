import type { AddressObject, EmailAddress, MailParser } from "mailparser";
import { z } from "zod";
import { sanitizeInboundHtml } from "../sanitizeHtml";
import type { MailAddress, RawMailAttachment, RawParsedMail } from "./rawMimeTypes";

function flattenAddresses(values: EmailAddress[]): MailAddress[] {
  return values.flatMap((value) =>
    value.group !== undefined
      ? flattenAddresses(value.group)
      : value.address === undefined || value.address === ""
        ? []
        : [{ email: value.address, name: value.name === "" ? null : value.name }],
  );
}

function addresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
  return value === undefined
    ? []
    : flattenAddresses((Array.isArray(value) ? value : [value]).flatMap((entry) => entry.value));
}

export function rawMimeFields(parser: MailParser, attachments: RawMailAttachment[]): RawParsedMail {
  const attempt = z
    .uuid()
    .safeParse(
      parser.headers === false ? undefined : parser.headers.get("x-warpdrive-send-attempt"),
    );
  return {
    rfcMessageId: parser.messageId ?? null,
    warpdriveSendAttemptId: attempt.success ? attempt.data : null,
    inReplyTo: parser.inReplyTo ?? null,
    references:
      parser.references === undefined
        ? []
        : typeof parser.references === "string"
          ? [parser.references]
          : parser.references,
    date: parser.date === undefined || Number.isNaN(parser.date.getTime()) ? null : parser.date,
    subject: parser.subject ?? null,
    from: addresses(parser.from),
    to: addresses(parser.to),
    cc: addresses(parser.cc),
    bcc: addresses(parser.bcc),
    replyTo: addresses(parser.replyTo),
    text: parser.text === false ? null : parser.text,
    html: parser.html === false ? null : sanitizeInboundHtml(parser.html, { allowRemote: false }),
    htmlWithRemoteImages:
      parser.html === false ? null : sanitizeInboundHtml(parser.html, { allowRemote: true }),
    attachments,
  };
}
