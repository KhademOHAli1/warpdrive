import type { Locale } from "@/features/i18n/registry";

export type AuthMailKind =
  | "invitation"
  | "verification"
  | "password_reset"
  | "security_change"
  | "recovery";
export interface AuthMailInput {
  userId?: string;
  invitationId?: string;
  recipient: string;
  locale: Locale;
  kind: AuthMailKind;
  url?: string;
  detail?:
    | "password"
    | "email"
    | "factor"
    | "provider"
    | "sessions"
    | "recovery"
    | "admin_access"
    | "admin_sessions"
    | "operator_recovery";
}

const administrativeCopy = {
  en: {
    admin_access: [
      "Your Warpdrive access changed",
      "An administrator changed your access to this Warpdrive workspace. If you did not expect this change, contact your workspace administrator.",
      "Review account security",
    ],
    admin_sessions: [
      "Your Warpdrive sessions were ended",
      "An administrator ended one or more of your sessions or connected-app authorizations. You may need to sign in and connect your apps again. Contact your administrator if this was unexpected.",
      "Review account security",
    ],
    operator_recovery: [
      "Warpdrive account recovery completed",
      "A host operator completed your approved recovery request. Your previous authenticators and passkeys were removed, and sessions and connected-app authorizations were revoked. Follow your administrator's verified recovery instructions to regain access.",
      "Review account security",
    ],
  },
  de: {
    admin_access: [
      "Ihr Zugriff auf Warpdrive wurde geändert",
      "Die Administration hat Ihren Zugriff auf diesen Warpdrive-Arbeitsbereich geändert. Falls Sie diese Änderung nicht erwartet haben, wenden Sie sich an Ihre Administration.",
      "Kontosicherheit prüfen",
    ],
    admin_sessions: [
      "Ihre Warpdrive-Sitzungen wurden beendet",
      "Die Administration hat eine oder mehrere Ihrer Sitzungen oder App-Freigaben beendet. Möglicherweise müssen Sie sich erneut anmelden und Ihre Apps neu verbinden. Wenden Sie sich bei unerwarteten Änderungen an Ihre Administration.",
      "Kontosicherheit prüfen",
    ],
    operator_recovery: [
      "Ihr Warpdrive-Konto wurde wiederhergestellt",
      "Ein Systembetreiber hat Ihre genehmigte Wiederherstellung abgeschlossen. Ihre bisherigen Authenticator-Einträge und Passkeys wurden entfernt, Sitzungen und App-Freigaben wurden widerrufen. Folgen Sie den verifizierten Anweisungen Ihrer Administration, um den Zugang wieder einzurichten.",
      "Kontosicherheit prüfen",
    ],
  },
  fa: {
    admin_access: [
      "دسترسی شما در Warpdrive تغییر کرد",
      "مدیر، دسترسی شما به این فضای کاری Warpdrive را تغییر داده است. اگر انتظار این تغییر را نداشتید، با مدیر فضای کاری تماس بگیرید.",
      "بررسی امنیت حساب",
    ],
    admin_sessions: [
      "نشست‌های شما در Warpdrive پایان یافت",
      "مدیر، یک یا چند نشست یا مجوز اتصال برنامه‌های شما را لغو کرده است. ممکن است لازم باشد دوباره وارد شوید و برنامه‌ها را مجدداً متصل کنید. اگر انتظار این تغییر را نداشتید، با مدیر تماس بگیرید.",
      "بررسی امنیت حساب",
    ],
    operator_recovery: [
      "بازیابی حساب Warpdrive شما انجام شد",
      "مسئول سامانه، درخواست بازیابی تأییدشدهٔ شما را انجام داد. برنامه‌های رمزساز و گذرکلیدهای قبلی حذف شدند و نشست‌ها و مجوزهای اتصال برنامه‌ها لغو شدند. برای برقراری دوبارهٔ دسترسی، راهنمای تأییدشدهٔ مدیر را دنبال کنید.",
      "بررسی امنیت حساب",
    ],
  },
} as const;

const copy = {
  en: {
    invitation: [
      "Your Warpdrive invitation",
      "You have been invited to your team's Warpdrive workspace. Accept this invitation to set up your account. The link expires in 72 hours.",
      "Accept invitation",
    ],
    verification: [
      "Verify your Warpdrive email address",
      "Confirm that this email address belongs to you to finish setting up your Warpdrive account. If you did not request this, you can ignore this message.",
      "Verify email address",
    ],
    password_reset: [
      "Reset your Warpdrive password",
      "A password reset was requested for your Warpdrive account. Use this secure link to choose a new password. Your required second factor will still be needed.",
      "Reset password",
    ],
    security_change: [
      "Your Warpdrive security settings changed",
      "Security settings for your Warpdrive account were changed. If you did not make this change, contact your workspace administrator immediately and review your active sessions.",
      "Review account security",
    ],
    recovery: [
      "Warpdrive account recovery",
      "A recovery request for your Warpdrive account has been recorded. Your administrator must verify ownership before any security factor can be reset. A request alone does not restore access.",
      "Review recovery request",
    ],
    footer:
      "This message was sent by your self-hosted Warpdrive installation. Never share passwords, verification codes or recovery codes with anyone.",
  },
  de: {
    invitation: [
      "Ihre Einladung zu Warpdrive",
      "Sie wurden zum Warpdrive-Arbeitsbereich Ihres Teams eingeladen. Nehmen Sie die Einladung an, um Ihr Konto einzurichten. Der Link ist 72 Stunden gültig.",
      "Einladung annehmen",
    ],
    verification: [
      "E-Mail-Adresse für Warpdrive bestätigen",
      "Bestätigen Sie, dass diese E-Mail-Adresse Ihnen gehört, um die Einrichtung Ihres Warpdrive-Kontos abzuschließen. Falls Sie dies nicht angefordert haben, können Sie diese Nachricht ignorieren.",
      "E-Mail-Adresse bestätigen",
    ],
    password_reset: [
      "Warpdrive-Passwort zurücksetzen",
      "Für Ihr Warpdrive-Konto wurde eine Passwortzurücksetzung angefordert. Über diesen sicheren Link können Sie ein neues Passwort festlegen. Ihr erforderlicher zweiter Faktor bleibt weiterhin notwendig.",
      "Passwort zurücksetzen",
    ],
    security_change: [
      "Ihre Sicherheitseinstellungen wurden geändert",
      "Die Sicherheitseinstellungen Ihres Warpdrive-Kontos wurden geändert. Falls Sie diese Änderung nicht vorgenommen haben, wenden Sie sich sofort an die Administration Ihres Arbeitsbereichs und prüfen Sie Ihre aktiven Sitzungen.",
      "Kontosicherheit prüfen",
    ],
    recovery: [
      "Wiederherstellung Ihres Warpdrive-Kontos",
      "Für Ihr Warpdrive-Konto wurde eine Wiederherstellung angefragt. Die Administration muss Ihre Identität prüfen, bevor ein Sicherheitsfaktor zurückgesetzt werden kann. Die Anfrage allein stellt den Zugriff nicht wieder her.",
      "Wiederherstellungsanfrage prüfen",
    ],
    footer:
      "Diese Nachricht stammt von Ihrer selbst gehosteten Warpdrive-Installation. Geben Sie Passwörter, Bestätigungscodes und Wiederherstellungscodes niemals weiter.",
  },
  fa: {
    invitation: [
      "دعوت شما به Warpdrive",
      "شما به فضای کاری تیم خود در Warpdrive دعوت شده‌اید. برای راه‌اندازی حساب، این دعوت را بپذیرید. اعتبار پیوند ۷۲ ساعت است.",
      "پذیرش دعوت",
    ],
    verification: [
      "تأیید نشانی ایمیل در Warpdrive",
      "برای تکمیل راه‌اندازی حساب Warpdrive، تأیید کنید که این نشانی ایمیل متعلق به شماست. اگر این درخواست را شما ثبت نکرده‌اید، می‌توانید پیام را نادیده بگیرید.",
      "تأیید نشانی ایمیل",
    ],
    password_reset: [
      "بازنشانی گذرواژه Warpdrive",
      "برای حساب Warpdrive شما درخواست بازنشانی گذرواژه ثبت شده است. با این پیوند امن، گذرواژه تازه‌ای تعیین کنید. در صورت فعال بودن تأیید دومرحله‌ای، همچنان به مرحله دوم نیاز دارید.",
      "بازنشانی گذرواژه",
    ],
    security_change: [
      "تنظیمات امنیتی حساب شما تغییر کرد",
      "تنظیمات امنیتی حساب Warpdrive شما تغییر کرده است. اگر این تغییر را شما انجام نداده‌اید، بی‌درنگ با مدیر فضای کاری تماس بگیرید و نشست‌های فعال خود را بررسی کنید.",
      "بررسی امنیت حساب",
    ],
    recovery: [
      "بازیابی حساب Warpdrive",
      "درخواست بازیابی حساب Warpdrive شما ثبت شد. پیش از بازنشانی هر عامل امنیتی، مدیر باید مالکیت حساب را بررسی کند. ثبت درخواست به‌تنهایی دسترسی به حساب را برنمی‌گرداند.",
      "بررسی درخواست بازیابی",
    ],
    footer:
      "این پیام از نصب خودمیزبان Warpdrive شما ارسال شده است. گذرواژه، کد تأیید و کد بازیابی را در اختیار هیچ‌کس نگذارید.",
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

export function renderAuthMail(input: AuthMailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const messages = copy[input.locale];
  const [subject, description, action] =
    input.kind === "security_change" &&
    (input.detail === "admin_access" ||
      input.detail === "admin_sessions" ||
      input.detail === "operator_recovery")
      ? administrativeCopy[input.locale][input.detail]
      : messages[input.kind];
  const direction = input.locale === "fa" ? "rtl" : "ltr";
  const link =
    input.url === undefined
      ? ""
      : `<p><a dir="ltr" href="${escapeHtml(input.url)}">${escapeHtml(action)}</a></p>`;
  return {
    subject,
    text: `${description}\n\n${input.url ?? ""}\n\n${messages.footer}\nWarpdrive`,
    html: `<div lang="${input.locale}" dir="${direction}"><h1>${escapeHtml(subject)}</h1><p>${escapeHtml(description)}</p>${link}<p>${escapeHtml(messages.footer)}</p><p>Warpdrive</p></div>`,
  };
}
