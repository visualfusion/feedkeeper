import { type ContentRule } from "../shared.js";
import { firstSrcsetSource, imageSource, usableImageSource } from "../../imageSources.js";

export const lazyImages: ContentRule = {
  name: "lazy-images",
  description: "Lazy image addresses replace missing, data placeholders or script fragments parsed as image URLs.",
  apply(root, stats) {
    let changed = false;
    for (const image of root.querySelectorAll("img")) {
      if (usableImageSource(image.getAttribute("src"))) continue;
      let source = imageSource((name) => image.getAttribute(name));
      for (const candidate of image.closest("picture")?.querySelectorAll("source") ?? []) {
        source ??= firstSrcsetSource(candidate.getAttribute("data-lazy-srcset") ?? candidate.getAttribute("data-srcset") ?? candidate.getAttribute("srcset"));
      }
      if (!source) continue;
      image.setAttribute("src", source);
      stats["lazy-images"] = (stats["lazy-images"] ?? 0) + 1;
      changed = true;
    }
    return changed;
  },
};
