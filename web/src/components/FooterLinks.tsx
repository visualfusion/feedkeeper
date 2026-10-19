import { useTranslation } from "react-i18next";
import { resolveFooterLinks } from "../extensions/host.ts";
import { useExtensions } from "../extensions/useExtensions.ts";

const placements = {
  /** Under the sign-in card. */
  login: "mt-4 justify-center text-xs",
  /** At the bottom of the account menu. */
  menu: "border-t border-[var(--c-border)] px-3 py-2.5 text-xs",
  /** At the end of a page. */
  page: "mt-10 border-t border-[var(--c-border)] pt-4 text-xs",
} as const;

/** Links an operator or host adds, such as the legal notice; nothing is shown without them. */
export function FooterLinks({ placement }: { placement: keyof typeof placements }) {
  const { t, i18n } = useTranslation();
  const links = resolveFooterLinks(useExtensions(), i18n.resolvedLanguage || "en", placement);
  if (links.length === 0) return null;
  return (
    <nav aria-label={t("nav.footerLinks")} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--c-text-muted)] ${placements[placement]}`}>
      {links.map((link, index) => (
        <span key={`${link.href}-${index}`} className="inline-flex items-center gap-3">
          {index > 0 && <span aria-hidden="true" className="opacity-50">•</span>}
          <a
            href={link.href}
            {...(link.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="transition-colors hover:text-[var(--c-text)] hover:underline"
          >
            {link.icon && <img src={link.icon} alt="" width={14} height={14} className="mr-1.5 inline-block align-[-2px]" />}
            {link.label}
          </a>
        </span>
      ))}
    </nav>
  );
}
