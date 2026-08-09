import { Link } from "@tanstack/react-router";
import { Button } from "../../components/ui/button.jsx";
import { DEFAULT_SETTINGS_SECTION } from "../../route-resolution.js";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import { settingsSectionList } from "./section-registry.jsx";

export function SettingsPage({
  section = DEFAULT_SETTINGS_SECTION,
  role,
  modelSetup,
  catalog,
  focusProvider,
  preferencesSnapshot,
  dataQuality,
  send,
  setToast,
  onOpenProviders,
  onOpenModelSetup,
  onOpenSidebar,
  onOpenHome,
  sidebarCollapsed = false,
  onExpandSidebar,
  sections = settingsSectionList,
}) {
  const active = sections.find((item) => item.slug === section) || sections[0];
  const SectionBody = active.Component;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenHome={onOpenHome} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full min-w-0 max-w-[1240px] flex-col gap-4">
          <header className="min-w-0 px-1">
            <h1 className="m-0 text-balance text-[17px] font-semibold text-foreground">Settings</h1>
            <p className="m-0 mt-1 text-pretty text-xs text-muted-foreground">
              Model, data sources, and the state OpenCandle keeps for you.
            </p>
          </header>
          <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:gap-6">
            <SectionRail sections={sections} activeSlug={active.slug} />
            <div className="min-w-0 flex-1">
              <div className="min-w-0 px-1">
                <h2 className="m-0 text-balance text-sm font-semibold text-foreground">
                  {active.label}
                </h2>
                <p className="m-0 mt-1 text-pretty text-xs text-muted-foreground">
                  {active.description}
                </p>
              </div>
              <div className="mt-3 min-w-0" data-slot="settings-section" data-section={active.slug}>
                <SectionBody
                  section={active}
                  role={role}
                  modelSetup={modelSetup}
                  catalog={catalog}
                  focusProvider={focusProvider}
                  preferencesSnapshot={preferencesSnapshot}
                  dataQuality={dataQuality}
                  send={send}
                  setToast={setToast}
                  onOpenProviders={onOpenProviders}
                  onOpenModelSetup={onOpenModelSetup}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </section>
  );
}

// One rail: a horizontally scrollable strip above the content on phones, a
// fixed column beside it from md up. The negative margin lets the strip scroll
// edge to edge without the page itself scrolling sideways.
function SectionRail({ sections, activeSlug }) {
  return (
    <nav
      aria-label="Settings sections"
      data-slot="settings-rail"
      className="-mx-4 flex min-w-0 shrink-0 gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 md:mx-0 md:w-[220px] md:flex-col md:gap-0.5 md:overflow-x-clip md:px-0 md:pb-0"
    >
      {sections.map((item) => {
        const active = item.slug === activeSlug;
        const Icon = item.icon;
        return (
          <Button
            key={item.slug}
            asChild
            variant={active ? "default" : "ghost"}
            size="sm"
            className="shrink-0 justify-start md:w-full"
          >
            <Link
              to="/settings/$section"
              params={{ section: item.slug }}
              aria-current={active ? "page" : undefined}
            >
              {Icon ? <Icon className="button-icon" aria-hidden="true" /> : null}
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
