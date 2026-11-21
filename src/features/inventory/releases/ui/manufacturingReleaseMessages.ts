import type { ReleaseArtifactKind, ReleaseFixtureCommand, ReleaseFixtureError } from "../contracts";

type ReleaseLabels = {
  heading: string;
  localFixture: string;
  activeRelease: string;
  noActiveRelease: string;
  history: string;
  noReleases: string;
  draft: string;
  released: string;
  revision: string;
  shortRevision: string;
  createDraft: string;
  packageFiles: string;
  noFiles: string;
  fileRole: string;
  productionFile: string;
  addFile: string;
  download: string;
  remove: string;
  missingFiles: string;
  approve: string;
  buildPins: string;
  openBuildRelease: (id: string) => string;
  noBuilds: string;
  previewBuild: string;
  kinds: Record<ReleaseArtifactKind, string>;
  notices: Record<ReleaseFixtureCommand["type"], string>;
  errors: Record<ReleaseFixtureError, string>;
};

const en: ReleaseLabels = {
  heading: "Manufacturing releases",
  localFixture: "Browser-only preview. Files and changes reset on reload.",
  activeRelease: "Active release",
  noActiveRelease: "No release has been approved.",
  history: "Release history",
  noReleases: "No manufacturing releases yet.",
  draft: "Draft",
  released: "Released",
  revision: "Revision",
  shortRevision: "Rev",
  createDraft: "Create draft",
  packageFiles: "Release files",
  noFiles: "No files added.",
  fileRole: "File role",
  productionFile: "Production file",
  addFile: "Add file",
  download: "Download",
  remove: "Remove",
  missingFiles: "Required files still missing",
  approve: "Approve release",
  buildPins: "Build pins",
  openBuildRelease: (id) => `Open release for ${id}`,
  noBuilds: "No preview builds yet.",
  previewBuild: "Preview build",
  kinds: {
    pcbFabrication: "PCB fabrication",
    manufacturingBom: "Manufacturing BOM",
    placement: "Pick-and-place",
    enclosure: "Enclosure",
    firmware: "Firmware",
    labelArtwork: "Label artwork",
    testInstructions: "Test instructions",
  },
  notices: {
    createDraft: "Draft created.",
    addArtifact: "File added.",
    removeArtifact: "File removed.",
    approve: "Release approved.",
    previewBuild: "Preview build pinned to the active release.",
  },
  errors: {
    invalidRevision:
      "Enter a revision of up to 20 characters using letters, numbers, dots, hyphens or underscores.",
    revisionExists: "This revision already exists.",
    releaseNotFound: "This release could not be found.",
    releaseImmutable: "A released package is read-only.",
    emptyFile: "Choose a file containing data.",
    fileTooLarge: "Choose a file no larger than 25 MiB.",
    invalidFileType: "Use ZIP for PCB fabrication and CSV for the manufacturing BOM.",
    artifactNotFound: "This file could not be found.",
    missingRequiredArtifacts: "Add the required files before approval.",
    noActiveRelease: "Approve a release before previewing a build.",
  },
};

const de: ReleaseLabels = {
  heading: "Fertigungsfreigaben",
  localFixture: "Vorschau im Browser. Dateien und Änderungen werden beim Neuladen zurückgesetzt.",
  activeRelease: "Aktive Freigabe",
  noActiveRelease: "Es wurde noch keine Revision freigegeben.",
  history: "Freigabeverlauf",
  noReleases: "Noch keine Fertigungsfreigaben.",
  draft: "Entwurf",
  released: "Freigegeben",
  revision: "Revision",
  shortRevision: "Rev.",
  createDraft: "Entwurf erstellen",
  packageFiles: "Freigabedateien",
  noFiles: "Noch keine Dateien hinzugefügt.",
  fileRole: "Dateityp",
  productionFile: "Fertigungsdatei",
  addFile: "Datei hinzufügen",
  download: "Herunterladen",
  remove: "Entfernen",
  missingFiles: "Noch benötigte Dateien",
  approve: "Revision freigeben",
  buildPins: "Fertigungsaufträge nach Revision",
  openBuildRelease: (id) => `Freigabe für ${id} öffnen`,
  noBuilds: "Noch keine Vorschauaufträge.",
  previewBuild: "Fertigungsauftrag simulieren",
  kinds: {
    pcbFabrication: "Leiterplattenfertigung",
    manufacturingBom: "Fertigungsstückliste",
    placement: "Bestückungsdaten",
    enclosure: "Gehäuse",
    firmware: "Firmware",
    labelArtwork: "Etikettenvorlage",
    testInstructions: "Prüfanweisungen",
  },
  notices: {
    createDraft: "Entwurf erstellt.",
    addArtifact: "Datei hinzugefügt.",
    removeArtifact: "Datei entfernt.",
    approve: "Revision freigegeben.",
    previewBuild: "Der Vorschauauftrag verwendet die aktive Revision.",
  },
  errors: {
    invalidRevision:
      "Geben Sie bis zu 20 Buchstaben, Zahlen, Punkte, Bindestriche oder Unterstriche ein.",
    revisionExists: "Diese Revision existiert bereits.",
    releaseNotFound: "Diese Freigabe wurde nicht gefunden.",
    releaseImmutable: "Eine freigegebene Revision ist schreibgeschützt.",
    emptyFile: "Wählen Sie eine Datei mit Inhalt.",
    fileTooLarge: "Wählen Sie eine Datei mit höchstens 25 MiB.",
    invalidFileType:
      "Verwenden Sie ZIP für Leiterplattendaten und CSV für die Fertigungsstückliste.",
    artifactNotFound: "Diese Datei wurde nicht gefunden.",
    missingRequiredArtifacts: "Fügen Sie die benötigten Dateien vor der Freigabe hinzu.",
    noActiveRelease: "Geben Sie eine Revision frei, bevor Sie einen Auftrag simulieren.",
  },
};

const fa: ReleaseLabels = {
  heading: "نسخه‌های تولید",
  localFixture: "پیش‌نمایش در مرورگر. با بارگیری دوباره، فایل‌ها و تغییرات بازنشانی می‌شوند.",
  activeRelease: "نسخه فعال",
  noActiveRelease: "هنوز نسخه‌ای تأیید نشده است.",
  history: "تاریخچه نسخه‌ها",
  noReleases: "هنوز نسخه تولیدی وجود ندارد.",
  draft: "پیش‌نویس",
  released: "تأییدشده",
  revision: "ویرایش",
  shortRevision: "نسخه",
  createDraft: "ایجاد پیش‌نویس",
  packageFiles: "فایل‌های نسخه",
  noFiles: "فایلی اضافه نشده است.",
  fileRole: "نقش فایل",
  productionFile: "فایل تولید",
  addFile: "افزودن فایل",
  download: "بارگیری",
  remove: "حذف",
  missingFiles: "فایل‌های لازم که هنوز اضافه نشده‌اند",
  approve: "تأیید نسخه",
  buildPins: "نسخه‌های ثبت‌شده سفارش‌های ساخت",
  openBuildRelease: (id) => `نمایش نسخه سفارش ساخت ${id}`,
  noBuilds: "هنوز سفارش ساخت آزمایشی وجود ندارد.",
  previewBuild: "پیش‌نمایش ساخت",
  kinds: {
    pcbFabrication: "ساخت برد مدار چاپی",
    manufacturingBom: "فهرست مواد تولید",
    placement: "داده‌های جانمایی قطعات",
    enclosure: "محفظه",
    firmware: "میان‌افزار",
    labelArtwork: "طرح برچسب",
    testInstructions: "دستورالعمل آزمون",
  },
  notices: {
    createDraft: "پیش‌نویس ایجاد شد.",
    addArtifact: "فایل اضافه شد.",
    removeArtifact: "فایل حذف شد.",
    approve: "نسخه تأیید شد.",
    previewBuild: "سفارش ساخت آزمایشی به نسخه فعال پیوند داده شد.",
  },
  errors: {
    invalidRevision: "نام ویرایش را حداکثر با ۲۰ حرف، رقم، نقطه، خط تیره یا زیرخط وارد کنید.",
    revisionExists: "این ویرایش از قبل وجود دارد.",
    releaseNotFound: "این نسخه پیدا نشد.",
    releaseImmutable: "نسخه تأییدشده فقط خواندنی است.",
    emptyFile: "فایلی دارای محتوا انتخاب کنید.",
    fileTooLarge: "فایلی با اندازه حداکثر ۲۵ مِبی‌بایت انتخاب کنید.",
    invalidFileType: "برای ساخت برد از ZIP و برای فهرست مواد تولید از CSV استفاده کنید.",
    artifactNotFound: "این فایل پیدا نشد.",
    missingRequiredArtifacts: "پیش از تأیید، فایل‌های لازم را اضافه کنید.",
    noActiveRelease: "پیش از پیش‌نمایش ساخت یک نسخه را تأیید کنید.",
  },
};

export const manufacturingReleaseMessages = { en, de, fa };
