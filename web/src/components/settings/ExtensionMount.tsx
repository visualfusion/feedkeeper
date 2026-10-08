import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/** Hands a container to a script of the host and cleans up when the content goes away. */
export function ExtensionMount({ name, mount }: { name: string; mount: (container: HTMLElement) => void | (() => void) }) {
  const container = useRef<HTMLDivElement>(null);
  // The host's content is built in the language of the app, so it is built again when the language changes.
  const language = useTranslation().i18n.resolvedLanguage;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cleanup: void | (() => void);
    try {
      cleanup = mount(element);
    } catch (error) {
      console.error(`[extensions] "${name}" failed to open`, error);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch (error) {
        console.error(`[extensions] "${name}" failed to close`, error);
      }
      element.replaceChildren();
    };
    // The host's mount function identifies the content; a new object with the same name must not remount it.
  }, [name, language]);
  return <div ref={container} className="min-w-0" />;
}
