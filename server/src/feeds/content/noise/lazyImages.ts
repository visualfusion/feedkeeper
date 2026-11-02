import { type ContentRule } from "../shared.js";

/** A script accidentally parsed as a URL is never an image, even after it was made absolute. */
export const SCRIPT_IMAGE_SOURCE = /\bthis\.src\s*=/i;

export const lazyImages: ContentRule = {
  name: "lazy-images",
  description: "Lazy image addresses replace missing, data placeholders or script fragments parsed as image URLs.",
  apply(root, stats) {
    let changed = false;
    for (const image of root.querySelectorAll("img")) {
      const current = image.getAttribute("src") ?? "";
      if (current && !/^data:/i.test(current) && !SCRIPT_IMAGE_SOURCE.test(current)) continue;
      const source = image.getAttribute("data-lazy-src") || image.getAttribute("data-src") || image.getAttribute("data-original");
      if (!source || !/^(?:https?:\/\/|\/)/i.test(source) || SCRIPT_IMAGE_SOURCE.test(source)) continue;
      image.setAttribute("src", source);
      stats["lazy-images"] = (stats["lazy-images"] ?? 0) + 1;
      changed = true;
    }
    return changed;
  },
};
