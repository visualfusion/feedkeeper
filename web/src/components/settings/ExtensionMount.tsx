import { useEffect, useRef } from "react";

/** Hands a container to a script of the host and cleans up when the content goes away. */
export function ExtensionMount({ name, mount }: { name: string; mount: (container: HTMLElement) => void | (() => void) }) {
  const container = useRef<HTMLDivElement>(null);
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
    // The host's mount function identifies the content; a new object with the same name must not
    // remount it, so `mount` is deliberately left out of the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return <div ref={container} className="min-w-0" />;
}
