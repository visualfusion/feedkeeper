import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import type { PageExtension } from "../extensions/host.ts";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative z-10 flex h-full items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)] ${
    isActive ? "text-[var(--c-text)]" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
  }`;

/** Desktop section switch styled like the view toggle, with a sliding active pill. */
export function DesktopNav({ onItemsClick, pages }: { onItemsClick: () => void; pages: PageExtension[] }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const containerRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const pageIds = pages.map(({ id, label }) => id + label).join("|");

  // Links differ in width (label length per language), so the pill is measured, not a fixed fraction.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const active = container.querySelector<HTMLElement>('a[aria-current="page"]');
      setIndicator(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    container.querySelectorAll("a").forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [location.pathname, i18n.resolvedLanguage, pageIds]);

  return (
    <nav ref={containerRef} className="relative hidden h-9 items-center rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] p-0.5 md:flex">
      {indicator && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0.5 left-0 rounded-lg border border-[var(--c-mobile-nav-active-border)] bg-[var(--c-mobile-nav-active)] shadow-sm transition-[transform,width] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none"
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
        />
      )}
      {pages.map(({ id, label, icon }) => (
        <NavLink key={id} to={`/extensions/${id}`} className={linkClass}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {icon.map((path) => <path key={path} d={path} />)}
          </svg>
          {label}
        </NavLink>
      ))}
      <NavLink to="/items" onClick={onItemsClick} className={linkClass}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h12" /></svg>
        {t("nav.items")}
      </NavLink>
      <NavLink to="/feeds" className={linkClass}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></svg>
        {t("nav.feeds")}
      </NavLink>
    </nav>
  );
}
