import type { Locale } from "@/features/i18n/registry";

type LiveReleaseLabels = {
  checksumAlgorithm: string;
  loading: string;
  unavailable: string;
  retry: string;
  operationFailed: string;
  uploadFailed: string;
  releaseRequired: string;
  releaseRequiredHelp: string;
  permissions: string;
  engineer: string;
  approver: string;
  staffMember: string;
  grantRole: string;
  saveGrant: string;
  revokeGrant: (name: string) => string;
  noGrants: string;
  chooseStaff: string;
  permissionSaved: string;
  requirementSaved: string;
  approvalHistory: string;
  createdBy: string;
  approvedBy: string;
  awaitingApproval: string;
  approveTitle: string;
  approveDescription: string;
  cancel: string;
  bom: string;
  material: string;
  quantityPerUnit: string;
  buildRelease: string;
  pinnedBuild: (id: string) => string;
  project: string;
  templateRevision: string;
};

const en: LiveReleaseLabels = {
  checksumAlgorithm: "SHA-256",
  loading: "Loading manufacturing releases…",
  unavailable: "Manufacturing releases are unavailable for this product.",
  retry: "Retry",
  operationFailed: "The release action could not be completed. Refresh and try again.",
  uploadFailed: "Upload failed. Refresh the release before retrying.",
  releaseRequired: "Require an approved release for new builds",
  releaseRequiredHelp: "An approved package is required to start a new build.",
  permissions: "Release permissions",
  engineer: "Editor",
  approver: "Approver",
  staffMember: "Staff member",
  grantRole: "Role",
  saveGrant: "Save access",
  revokeGrant: (name) => `Revoke release access for ${name}`,
  noGrants: "No delegated access.",
  chooseStaff: "Choose a staff member",
  permissionSaved: "Release access updated.",
  requirementSaved: "Build release requirement updated.",
  approvalHistory: "Approval history",
  createdBy: "Draft created by",
  approvedBy: "Released by",
  awaitingApproval: "Awaiting approval",
  approveTitle: "Approve this manufacturing release?",
  approveDescription:
    "Approval freezes the files and BOM and makes this the active package for new builds.",
  cancel: "Cancel",
  bom: "Manufacturing BOM",
  material: "Component",
  quantityPerUnit: "Qty per unit",
  buildRelease: "Build release",
  pinnedBuild: (id) => `Package pinned to build ${id}`,
  project: "Open production project",
  templateRevision: "Production template revision",
};

const de: LiveReleaseLabels = {
  checksumAlgorithm: "SHA-256",
  loading: "Fertigungsfreigaben werden geladen …",
  unavailable: "Für dieses Produkt sind keine Fertigungsfreigaben verfügbar.",
  retry: "Erneut versuchen",
  operationFailed:
    "Die Aktion konnte nicht abgeschlossen werden. Laden Sie die Freigabe neu und versuchen Sie es erneut.",
  uploadFailed:
    "Der Upload ist fehlgeschlagen. Laden Sie die Freigabe vor einem neuen Versuch neu.",
  releaseRequired: "Freigegebene Revision für neue Fertigungsaufträge verlangen",
  releaseRequiredHelp: "Neue Fertigungsaufträge können erst mit einem freigegebenen Paket starten.",
  permissions: "Berechtigungen für Freigaben",
  engineer: "Bearbeitung",
  approver: "Freigabe",
  staffMember: "Teammitglied",
  grantRole: "Rolle",
  saveGrant: "Zugriff speichern",
  revokeGrant: (name) => `Zugriff auf Freigaben für ${name} entziehen`,
  noGrants: "Keine delegierten Berechtigungen.",
  chooseStaff: "Teammitglied auswählen",
  permissionSaved: "Freigabeberechtigungen aktualisiert.",
  requirementSaved: "Freigabeanforderung für neue Aufträge aktualisiert.",
  approvalHistory: "Freigabeverlauf",
  createdBy: "Entwurf erstellt von",
  approvedBy: "Freigegeben von",
  awaitingApproval: "Freigabe ausstehend",
  approveTitle: "Diese Fertigungsrevision freigeben?",
  approveDescription:
    "Die Freigabe schützt Dateien und Stückliste vor Änderungen und aktiviert das Paket für neue Fertigungsaufträge.",
  cancel: "Abbrechen",
  bom: "Fertigungsstückliste",
  material: "Komponente",
  quantityPerUnit: "Menge pro Einheit",
  buildRelease: "Freigabe des Fertigungsauftrags",
  pinnedBuild: (id) => `Paket für Fertigungsauftrag ${id}`,
  project: "Fertigungsprojekt öffnen",
  templateRevision: "Revision der Fertigungsvorlage",
};

const fa: LiveReleaseLabels = {
  checksumAlgorithm: "SHA-256",
  loading: "نسخه‌های تولید در حال بارگیری هستند…",
  unavailable: "نسخه‌های تولید این محصول در دسترس نیستند.",
  retry: "تلاش دوباره",
  operationFailed: "انجام عملیات نسخه ممکن نشد. صفحه را تازه کنید و دوباره تلاش کنید.",
  uploadFailed: "بارگذاری ناموفق بود. پیش از تلاش دوباره نسخه را تازه کنید.",
  releaseRequired: "نسخه تأییدشده برای سفارش‌های ساخت تازه الزامی باشد",
  releaseRequiredHelp: "برای شروع سفارش ساخت تازه، یک بسته تأییدشده لازم است.",
  permissions: "دسترسی به نسخه‌های تولید",
  engineer: "ویرایشگر",
  approver: "تأییدکننده",
  staffMember: "عضو تیم",
  grantRole: "نقش",
  saveGrant: "ذخیره دسترسی",
  revokeGrant: (name) => `لغو دسترسی ${name} به نسخه‌های تولید`,
  noGrants: "هیچ دسترسی واگذارشده‌ای وجود ندارد.",
  chooseStaff: "عضو تیم را انتخاب کنید",
  permissionSaved: "دسترسی به نسخه‌های تولید به‌روز شد.",
  requirementSaved: "الزام نسخه برای سفارش ساخت به‌روز شد.",
  approvalHistory: "تاریخچه تأیید",
  createdBy: "سازنده پیش‌نویس",
  approvedBy: "تأییدکننده",
  awaitingApproval: "در انتظار تأیید",
  approveTitle: "این نسخه تولید تأیید شود؟",
  approveDescription:
    "تأیید، فایل‌ها و فهرست مواد را ثابت می‌کند و این بسته را برای سفارش‌های ساخت تازه فعال می‌کند.",
  cancel: "لغو",
  bom: "فهرست مواد تولید",
  material: "قطعه",
  quantityPerUnit: "تعداد در هر واحد",
  buildRelease: "نسخه سفارش ساخت",
  pinnedBuild: (id) => `بسته ثبت‌شده برای سفارش ساخت ${id}`,
  project: "بازکردن پروژه تولید",
  templateRevision: "ویرایش الگوی تولید",
};

export const manufacturingReleaseLiveMessages: Record<Locale, LiveReleaseLabels> = { en, de, fa };
