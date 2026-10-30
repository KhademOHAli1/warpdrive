import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "@/constants/notificationTypes";
import { renderNotificationEmail } from "./render";

function render(over: {
  type?: (typeof NOTIFICATION_TYPES)[number];
  entityType: string | null;
  entityId: string | null;
}): ReturnType<typeof renderNotificationEmail> {
  return renderNotificationEmail(
    {
      id: "n1",
      userId: "u1",
      type: over.type ?? "activity_reminder",
      entityType: over.entityType,
      entityId: over.entityId,
      actorId: null,
      payload: { subject: "Meeting" },
      readAt: null,
      createdAt: new Date().toISOString(),
    },
    "Jane",
  );
}

describe("renderNotificationEmail link", () => {
  it("links to the real route for each entity type", () => {
    expect(render({ entityType: "deal", entityId: "d1" }).text).toContain("/deals/d1");
    // The old renderer pluralized the entity type: /persons/<id> and /organizations/<id>, neither
    // of which is a route in this app.
    expect(render({ entityType: "person", entityId: "p1" }).text).toContain("/contacts/people/p1");
    expect(render({ entityType: "organization", entityId: "o1" }).text).toContain(
      "/contacts/orgs/o1",
    );
    expect(render({ entityType: "lead", entityId: "l1" }).text).toContain("/leads/l1");
  });

  it("falls back to the app root for a ref with no detail route", () => {
    // "activity" used to render /activitys/<id>.
    const out = render({ entityType: "activity", entityId: "a1" });
    expect(out.text).not.toContain("/activitys/");
    expect(out.text).not.toContain("a1");
  });

  it("falls back to the app root when the row has no target", () => {
    expect(render({ entityType: null, entityId: null }).text).toContain("Open:");
  });
});

describe("renderNotificationEmail", () => {
  it.each(NOTIFICATION_TYPES)(
    "renders German %s email copy and the unnamed-recipient fallback",
    (type) => {
      const row = {
        id: "n-de",
        userId: "u-de",
        type,
        entityType: null,
        entityId: null,
        actorId: null,
        payload: {},
        readAt: null,
        createdAt: "2026-03-21T00:00:00Z",
      };

      const out = renderNotificationEmail(row, "", "de");

      expect(out.subject).not.toBe(renderNotificationEmail(row, "", "en").subject);
      expect(out.text).toContain("Hallo,");
      expect(out.text).toContain("\n\nÖffnen: ");
      expect(out.html).toContain('lang="de" dir="ltr"');
      expect(out.html).toContain("In Warpdrive öffnen");
    },
  );

  it("keeps a German incoming-email subject's authored title and canonical link", () => {
    const out = renderNotificationEmail(
      {
        id: "n-de-title",
        userId: "u-de",
        type: "deal_email_received",
        entityType: "deal",
        entityId: "d1",
        actorId: null,
        payload: { subject: "Angebot ۱۲۳ <Acme>" },
        readAt: null,
        createdAt: "2026-03-21T00:00:00Z",
      },
      "Alex",
      "de",
    );
    expect(out.subject).toBe("Neue E-Mail zu einer Verkaufschance: Angebot ۱۲۳ <Acme>");
    expect(out.text).toContain("Alex, zu einer Verkaufschance, der Sie folgen");
    expect(out.text).toContain("/deals/d1");
    expect(out.html).toContain('lang="de" dir="ltr"');
  });

  it("renders Persian email copy with safe mixed-direction customer content", () => {
    const out = renderNotificationEmail(
      {
        id: "n-fa",
        userId: "u1",
        type: "activity_reminder",
        entityType: "deal",
        entityId: "d1",
        actorId: null,
        payload: { subject: "Call <Acme>" },
        readAt: null,
        createdAt: "2026-03-21T08:00:00Z",
      },
      "درسا",
      "fa",
    );
    expect(out.subject).toContain("موعد انجام");
    expect(out.text).toContain("درسا");
    expect(out.text).toContain("Call <Acme>");
    expect(out.html).toContain('lang="fa" dir="rtl"');
    expect(out.html).toContain("Call &lt;Acme&gt;");
    expect(out.html).not.toContain("<Acme>");
    expect(out.text).toContain("/deals/d1");
  });

  it("localizes every notification email type and the unnamed-recipient fallback", () => {
    for (const type of NOTIFICATION_TYPES) {
      const out = renderNotificationEmail(
        {
          id: "n",
          userId: "u",
          type,
          entityType: null,
          entityId: null,
          actorId: null,
          payload: {},
          readAt: null,
          createdAt: "2026-03-21T00:00:00Z",
        },
        "",
        "fa",
      );
      expect(out.subject).toMatch(/[\u0600-\u06ff]/);
      expect(out.text).toContain("کاربر گرامی");
      expect(out.text).toContain("باز کردن:");
    }
  });
  it("renders a mention email with subject and bodies", () => {
    const out = renderNotificationEmail(
      {
        id: "n1",
        userId: "u1",
        type: "mention",
        entityType: "deal",
        entityId: "d1",
        actorId: "u2",
        payload: { source: "note", sourceId: "s1" },
        readAt: null,
        createdAt: new Date().toISOString(),
      },
      "Jane",
    );
    expect(out.subject).toContain("mentioned you");
    expect(out.text).toContain("Jane");
    expect(out.html).toContain("<");
  });

  it("renders an activity reminder email", () => {
    const out = renderNotificationEmail(
      {
        id: "n2",
        userId: "u1",
        type: "activity_reminder",
        entityType: "deal",
        entityId: "d1",
        actorId: null,
        payload: { subject: "Call Acme" },
        readAt: null,
        createdAt: new Date().toISOString(),
      },
      "Jane",
    );
    expect(out.subject).toContain("Reminder");
    expect(out.text).toContain("Call Acme");
  });

  it("renders a non-empty subject, text, and html for every notification type", () => {
    for (const type of NOTIFICATION_TYPES) {
      const out = renderNotificationEmail(
        {
          id: "n3",
          userId: "u1",
          type,
          entityType: null,
          entityId: null,
          actorId: null,
          payload: { subject: "Task" },
          readAt: null,
          createdAt: new Date().toISOString(),
        },
        "Bob",
      );
      expect(out.subject.length, `subject empty for type ${type}`).toBeGreaterThan(0);
      expect(out.text.length, `text empty for type ${type}`).toBeGreaterThan(0);
      expect(out.html, `html missing < for type ${type}`).toContain("<");
    }
  });
});
