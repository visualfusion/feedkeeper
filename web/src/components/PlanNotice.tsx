import { useTranslation } from "react-i18next";
import { usePlanLimits } from "../utils/planLimits.ts";

/** Says why adding and updating feeds is switched off for an account whose plan does not include it. */
export function PlanNotice() {
  const { t } = useTranslation();
  const { manageUrl } = usePlanLimits();
  return (
    <section role="status" className="card flex flex-col gap-2 p-4 sm:p-5" aria-labelledby="plan-notice-title">
      <h2 id="plan-notice-title" className="text-base font-semibold">{t("plan.limitedTitle")}</h2>
      <p className="text-sm text-[var(--c-text-muted)]">{t("plan.limitedText")}</p>
      {manageUrl && (
        <a href={manageUrl} className="btn-primary self-start" style={{ textDecoration: "none" }}>{t("plan.view")}</a>
      )}
    </section>
  );
}
