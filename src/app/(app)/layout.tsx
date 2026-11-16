import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ActionErrorProvider } from "@/components/shell/ActionErrorProvider";
import { CsrfRefresher } from "@/components/shell/CsrfRefresher";
import { LeftNav } from "@/components/shell/LeftNav";
import { ReconnectBanner } from "@/components/shell/ReconnectBanner";
import { TopBar } from "@/components/shell/TopBar";
import { WorkspaceShellProvider } from "@/components/shell/WorkspaceShellProvider";
import { NAV_PREF_COOKIE } from "@/constants/cookies";
import { CSRF_COOKIE } from "@/contracts/auth";
import { FollowUpPromptProvider } from "@/features/activities/followUpAfterDone";
import { CurrencyProvider } from "@/features/currencies/CurrencyProvider";
import { InterfacePrefsProvider } from "@/features/identity/InterfacePrefsProvider";
import { interfacePrefsFromUi } from "@/features/identity/interfacePrefs";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { hasNewsletterPermission } from "@/features/newsletter/permissions";
import { IdentifyUser } from "@/features/observability/IdentifyUser";
import { PRIVACY_CASE_PATH_HEADER, privacyCaseReturnPath } from "@/features/privacy/requestPath";
import { VersionBanner } from "@/features/release/ui/VersionBanner";
import { CommandPalette } from "@/features/search/ui/CommandPalette";
import { GlobalShortcuts } from "@/features/shortcuts/GlobalShortcuts";
import { appearanceSeedScript, parseAppearance } from "@/features/theme/appearance";
import { createContext, getBootstrap } from "@/frontend/context";

export default async function AppLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const ctx = await createContext();
  if (ctx.actor === null) {
    const requestHeaders = await headers();
    const target = ctx.pendingAuthentication ? "/auth/continue" : "/login";
    const returnPath = privacyCaseReturnPath(requestHeaders.get(PRIVACY_CASE_PATH_HEADER));
    redirect(returnPath === null ? target : `${target}?returnTo=${encodeURIComponent(returnPath)}`);
  }
  const jar = await cookies();
  const hasCsrf = jar.get(CSRF_COOKIE) !== undefined;
  // Read the persisted rail state server-side so the nav renders at its correct width on the first
  // paint. New visits use the expanded Finance OS desktop default; mobile uses a drawer.
  const navExpanded = jar.get(NAV_PREF_COOKIE)?.value !== "0";
  // The avatar name + photo now ride along on the hydrated actor (createContext already read the
  // user row), so the shell no longer re-reads that row per authenticated page. Only the per-user
  // interface preferences remain; default comfortable when no row exists (DealCard/Board read the
  // density via the data-density attribute).
  const { shell } = await getBootstrap();
  if (shell === null) redirect("/login");
  const { prefs, baseCurrency, brand, navigation, projects } = shell;
  return (
    <NativeActorProvider key={ctx.actor.id} actorId={ctx.actor.id}>
      <WorkspaceShellProvider
        brand={brand}
        modules={navigation.modules}
        canViewWork={navigation.canViewWork}
        canViewProjects={projects !== null && (projects.enabled || projects.canEnable)}
        canViewCampaigns={hasNewsletterPermission(ctx.actor, "view") && shell.newsletterConfigured}
        campaignCapabilities={{
          edit: hasNewsletterPermission(ctx.actor, "edit"),
          send: hasNewsletterPermission(ctx.actor, "send"),
          operate: hasNewsletterPermission(ctx.actor, "operate"),
        }}
      >
        <CurrencyProvider currency={baseCurrency}>
          <ActionErrorProvider>
            <IdentifyUser
              user={{
                id: ctx.actor.id,
                name: ctx.actor.name,
                email: ctx.actor.email,
                role: ctx.actor.type,
              }}
            />
            {/* Reconciles this device's theme cookie with the account's stored choice, inline and ahead
          of the shell, so a cold browser never paints a frame of the wrong theme. */}
            <script
              // biome-ignore lint/security/noDangerouslySetInnerHtml: three known literals; must be inline to beat first paint
              dangerouslySetInnerHTML={{
                __html: appearanceSeedScript(parseAppearance(prefs.ui.appearance)),
              }}
            />
            <InterfacePrefsProvider value={interfacePrefsFromUi(prefs.ui)}>
              <FollowUpPromptProvider>
                <div
                  data-density={prefs.density}
                  className="flex h-dvh min-h-0 flex-col overflow-hidden"
                >
                  <CsrfRefresher hasCsrf={hasCsrf} />
                  {ctx.actor.type === "admin" && <VersionBanner />}
                  <ReconnectBanner />
                  <div className="flex min-h-0 flex-1">
                    <LeftNav initialExpanded={navExpanded} />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                      <TopBar
                        workspaceBrand={brand}
                        userId={ctx.actor.id}
                        userName={ctx.actor.name}
                        avatarUrl={ctx.actor.avatarUrl}
                        appearance={parseAppearance(prefs.ui.appearance)}
                        showOperations={ctx.actor.type === "admin"}
                      />
                      <main
                        data-app-content
                        // biome-ignore lint/a11y/noNoninteractiveTabindex: the content scroll owner needs keyboard scrolling
                        tabIndex={0}
                        className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-y-contain bg-muted/70 p-6 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        {children}
                      </main>
                    </div>
                  </div>
                  <CommandPalette />
                  <GlobalShortcuts />
                </div>
              </FollowUpPromptProvider>
            </InterfacePrefsProvider>
          </ActionErrorProvider>
        </CurrencyProvider>
      </WorkspaceShellProvider>
    </NativeActorProvider>
  );
}
