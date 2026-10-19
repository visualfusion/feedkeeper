import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext.tsx";
import { AccountSettings } from "../components/settings/AccountSettings.tsx";
import { GeneralSettings } from "../components/settings/GeneralSettings.tsx";
import { FilterSettings } from "../components/settings/FilterSettings.tsx";
import { McpSettings } from "../components/settings/McpSettings.tsx";
import { DevicesSettings } from "../components/settings/DevicesSettings.tsx";
import { DatabaseSettings, UsersSettings } from "../components/settings/AdminSettings.tsx";
import { SectionHeader } from "../components/settings/ui.tsx";
import { ExtensionMount } from "../components/settings/ExtensionMount.tsx";
import { FooterLinks } from "../components/FooterLinks.tsx";
import { groupSettingsSections, resolveSettingsExtensions } from "../extensions/host.ts";
import { useExtensions } from "../extensions/useExtensions.ts";

const icon = (path: ReactNode) => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);

interface Section {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  admin?: boolean;
  /** Set for sections added by a hosting product: the heading they are listed under. */
  group?: string;
  render: () => ReactNode;
}

// Shown when a section from the host brings no icon of its own.
const DEFAULT_EXTENSION_ICON = ["M4 6h16M4 12h16M4 18h10"];

// The side navigation needs room next to the content; below this width the sections are a list of pages.
const WIDE_QUERY = "(min-width: 768px)";

function useIsWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isWide = useIsWide();
  const extensions = useExtensions();

  const builtIn: Section[] = [
    { id: "account", label: t("settings.sectionAccount"), description: t("settings.sectionAccountHint"), icon: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>), render: () => <AccountSettings /> },
    { id: "general", label: t("settings.sectionGeneral"), description: t("settings.sectionGeneralHint"), icon: icon(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>), render: () => <GeneralSettings /> },
    { id: "filters", label: t("settings.sectionFilters"), description: t("settings.sectionFiltersHint"), icon: icon(<path d="M3 5h18l-7 8v6l-4 2v-8Z" />), render: () => <FilterSettings /> },
    { id: "devices", label: t("settings.sectionDevices"), description: t("settings.sectionDevicesHint"), icon: icon(<><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></>), render: () => <DevicesSettings /> },
    { id: "mcp", label: t("settings.sectionMcp"), description: t("settings.sectionMcpHint"), icon: icon(<><path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0Z" /><path d="M12 17v4" /></>), render: () => <McpSettings /> },
    { id: "users", label: t("settings.sectionUsers"), description: t("settings.sectionUsersHint"), icon: icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>), admin: true, render: () => <UsersSettings /> },
    { id: "database", label: t("settings.sectionDatabase"), description: t("settings.sectionDatabaseHint"), icon: icon(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>), admin: true, render: () => <DatabaseSettings /> },
  ];
  const isAdmin = user?.role === "admin";
  const { hidden, sections: hostSections } = resolveSettingsExtensions(extensions, builtIn.map((section) => section.id), isAdmin);
  const extension: Section[] = hostSections.map((section) => ({
    id: section.id,
    label: section.label,
    description: section.description,
    group: section.group,
    icon: icon(<>{(section.icon ?? DEFAULT_EXTENSION_ICON).map((path) => <path key={path} d={path} />)}</>),
    render: () => <ExtensionMount name={`settings-${section.id}`} mount={section.mount} />,
  }));
  const available = [...builtIn.filter((section) => !hidden.has(section.id) && (!section.admin || isAdmin)), ...extension];
  const requested = available.find((section) => section.id === searchParams.get("tab"));
  const active = requested ?? available[0];

  const select = (id: string) => {
    setSearchParams(id === available[0].id ? {} : { tab: id }, { replace: true });
    window.scrollTo({ top: 0 });
  };

  // On narrow screens a section is its own page: opening it adds a history entry, so the back button returns to the list.
  const open = (id: string) => {
    navigate({ search: `?tab=${encodeURIComponent(id)}` }, { state: { fromList: true } });
    window.scrollTo({ top: 0 });
  };
  const backToList = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1);
    else navigate({ search: "" }, { replace: true });
    window.scrollTo({ top: 0 });
  };

  const navButton = (section: Section) => {
    const isActive = section.id === active.id;
    return (
      <button
        key={section.id}
        type="button"
        onClick={() => select(section.id)}
        aria-current={isActive ? "page" : undefined}
        className={`inline-flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)] ${isActive ? "bg-[var(--c-mobile-nav-active)] text-[var(--c-text)]" : "text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)]"}`}
      >
        {section.icon}
        {section.label}
      </button>
    );
  };

  const listRow = (section: Section) => (
    <li key={section.id}>
      <button
        type="button"
        onClick={() => open(section.id)}
        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left cursor-pointer transition-colors hover:bg-[var(--c-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text)]">
          {section.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--c-text)]">{section.label}</span>
          <span className="mt-0.5 block text-xs leading-snug text-[var(--c-text-muted)]">{section.description}</span>
        </span>
        <svg className="h-4 w-4 shrink-0 text-[var(--c-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
    </li>
  );

  const adminSections = available.filter((section) => section.admin && !section.group);
  const extensionGroups = groupSettingsSections(extension);
  const groupHeading = "mt-5 mb-1 px-3 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]";

  const listGroups: Array<{ key: string; heading?: string; sections: Section[] }> = [
    { key: "main", sections: available.filter((section) => !section.admin && !section.group) },
    ...(adminSections.length > 0 ? [{ key: "admin", heading: t("settings.adminGroup"), sections: adminSections }] : []),
    ...extensionGroups.map(({ group, sections: members }) => ({ key: group, heading: group, sections: members })),
  ];

  if (!isWide) {
    if (!requested) {
      return (
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
          <nav className="flex flex-col gap-6" aria-label={t("settings.title")}>
            {listGroups.map((group) => (
              <section key={group.key} aria-label={group.heading ?? t("settings.title")}>
                {group.heading && (
                  <h2 className="mb-2 px-1 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]">{group.heading}</h2>
                )}
                <ul className="card divide-y divide-[var(--c-border)] overflow-hidden p-0">{group.sections.map(listRow)}</ul>
              </section>
            ))}
          </nav>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={backToList} className="-ml-1 inline-flex w-fit items-center gap-1 rounded-lg px-1 py-1 text-sm font-medium text-[var(--c-text-muted)] cursor-pointer hover:text-[var(--c-text)] focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)]">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 6-6 6 6 6" />
          </svg>
          {t("settings.title")}
        </button>
        <div key={requested.id} className="min-w-0 animate-page-fade">
          <SectionHeader title={requested.label} description={requested.description} />
          {requested.render()}
          <FooterLinks placement="page" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

      <div className="grid grid-cols-[13rem_minmax(0,1fr)] gap-10">
        <nav className="sticky top-24 flex flex-col gap-0.5 self-start" aria-label={t("settings.title")}>
          {available.filter((section) => !section.admin && !section.group).map(navButton)}
          {adminSections.length > 0 && (
            <>
              <p className={groupHeading}>{t("settings.adminGroup")}</p>
              {adminSections.map(navButton)}
            </>
          )}
          {extensionGroups.map(({ group, sections: members }) => (
            <Fragment key={group}>
              <p className={groupHeading}>{group}</p>
              {members.map(navButton)}
            </Fragment>
          ))}
        </nav>

        <div key={active.id} className="min-w-0 animate-page-fade">
          <SectionHeader title={active.label} description={active.description} />
          {active.render()}
          <FooterLinks placement="page" />
        </div>
      </div>
    </div>
  );
}
