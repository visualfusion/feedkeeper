import { z } from "zod";
import { NativeError } from "./requests.js";

/**
 * A presentation plan for an edition. It says what the issue's writer considers important and what belongs together,
 * never how a screen draws it: clients map the roles onto their own columns, sizes and type.
 *
 * Versioned and strict. A client that meets a block type it does not know sets that block's stories as plain ones.
 */
const itemId = z.number().int().positive();
/** A short label above a headline: a classification, not a statement. */
const kicker = z.string().trim().min(1).max(40)
  .refine((value) => !/[\r\n]/.test(value) && !/[.!?:;,]$/.test(value), "A kicker is one short phrase without closing punctuation");
const story = { itemId, kicker: kicker.optional() };

const block = z.discriminatedUnion("type", [
  /** The story of the day; only once and only first. */
  z.object({ type: z.literal("lead"), ...story }).strict(),
  /** One overview topic (1-based position in `overview`) with the stories it is about. */
  z.object({ type: z.literal("dossier"), topic: z.number().int().min(1).max(5), itemIds: z.array(itemId).min(1).max(4) }).strict(),
  z.object({ type: z.literal("feature"), ...story }).strict(),
  z.object({ type: z.literal("standard"), stories: z.array(z.object(story).strict()).min(1).max(3) }).strict(),
  z.object({ type: z.literal("briefs"), itemIds: z.array(itemId).min(2).max(8), title: z.string().trim().min(1).max(60).optional() }).strict(),
  z.object({ type: z.literal("photo"), itemId }).strict(),
  /** A statement of an article set large. The issuer vouches that the text is quoted from the article. */
  z.object({ type: z.literal("quote"), itemId, text: z.string().trim().min(1).max(160) }).strict(),
]);

export const editionLayoutSchema = z.object({
  version: z.literal(1),
  character: z.enum(["dominant", "calm", "briefing"]),
  blocks: z.array(block).min(1).max(24),
}).strict();
export type EditionLayout = z.infer<typeof editionLayoutSchema>;

function blockItemIds(block: EditionLayout["blocks"][number]): number[] {
  switch (block.type) {
    case "standard": return block.stories.map((entry) => entry.itemId);
    case "dossier":
    case "briefs": return block.itemIds;
    default: return [block.itemId];
  }
}

/**
 * Checks a well-formed plan against the issue it is published with: every story is in the issue and appears once,
 * the lead stands first, and every topic exists and has one dossier at most.
 */
export function checkEditionLayout(layout: EditionLayout, itemIds: number[], topicCount: number): void {
  const allowed = new Set(itemIds);
  const used = new Set<number>();
  const topics = new Set<number>();
  layout.blocks.forEach((block, index) => {
    if (block.type === "lead" && index !== 0) throw new NativeError("invalid_layout");
    if (block.type === "dossier") {
      if (block.topic > topicCount) throw new NativeError("invalid_layout_reference");
      if (topics.has(block.topic)) throw new NativeError("invalid_layout");
      topics.add(block.topic);
    }
    for (const id of blockItemIds(block)) {
      if (!allowed.has(id)) throw new NativeError("invalid_layout_reference");
      if (used.has(id)) throw new NativeError("invalid_layout");
      used.add(id);
    }
  });
}
