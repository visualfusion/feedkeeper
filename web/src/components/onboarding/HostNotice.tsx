import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext.tsx";
import { resolveArticlesNotice } from "../../extensions/host.ts";
import { useExtensions } from "../../extensions/useExtensions.ts";
import { ExtensionMount } from "../settings/ExtensionMount.tsx";

/**
 * A notice a host puts above the articles (for a hosted service: what the plan includes). It waits for the introduction of the
 * app, so a person sees one card at a time, and the host decides with `applies` whether it is still to be shown.
 */
export function HostNotice() {
  const { user } = useAuth();
  const notice = resolveArticlesNotice(useExtensions());
  const [shown, setShown] = useState(false);
  const introClosed = Boolean(user?.intro_dismissed_at);
  useEffect(() => {
    let current = true;
    setShown(false);
    if (!notice || !user || !introClosed) return;
    Promise.resolve(notice.applies ? notice.applies({ id: user.id, email: user.email, display_name: user.display_name ?? null }) : true)
      .then((value) => { if (current) setShown(value === true); })
      .catch(() => { if (current) setShown(false); });
    return () => { current = false; };
    // The functions identify the host's notice; resolving builds a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.mount, notice?.applies, user?.id, introClosed]);
  if (!notice || !shown) return null;
  return <ExtensionMount name="articles-notice" mount={notice.mount} />;
}
