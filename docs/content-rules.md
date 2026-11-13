# Content rules

Publisher pages carry more than the story: players that need a script, consent notices where an embed would be,
lists of other articles inside the article's container. FeedKeeper cleans this up with small, independent **content
rules**. Each rule handles one kind of clutter, so a fix is a small change in one place, and anyone can add one.

Rules live in `server/src/feeds/content/`:

```
content/
  shared.ts              the rule interface and small helpers
  index.ts               the list of rules and the order they run in
  embeds/                rules that turn embeds into one marked link
  noise/                 rules that remove clutter around the story
  patterns/              patterns, hosts and labels, one file per language where words are involved
```

## What a rule is

A rule is an object with a `name`, a one-sentence `description` and an `apply(root, stats)` function that changes the
document in place and returns whether it changed anything. It must be:

- **Idempotent.** Running it over its own output changes nothing. The tests check this for every rule.
- **Removing or rewriting only.** A rule never invents content. An embed becomes a link to what the page already names.
- **Cautious.** When unsure, leave it. A story's own words must never be removed because they look like a notice.

The pipeline runs on a fetched page before scripts, frames and `noscript` blocks are removed (embeds keep their
address there), then Readability picks the article. Embeds also run on the HTML a feed delivers.

## Embeds become marked links

A video, a post, a player or a native audio or video element becomes one plain link with `data-media="video" | "social" | "audio"` and, where the
platform is known, `data-source` with its name. The web reader and the native apps show such a link as a card. Nothing
is ever embedded, and no platform script is loaded.

## Adding to a list (no code)

Most contributions are a pattern in one of the files under `patterns/`:

- A consent notice in another wording: `patterns/consent/<language>.ts`. Anchors start a notice, companions are its other
  lines. Match whole sentences or characteristic phrases. A single word such as "privacy" would hit articles about it.
- A social platform or audio player: `patterns/social-platforms.ts` (host, path of a single post, kind).
- A heading or markup that introduces a list of other articles: `patterns/sidebars/`.
- The label of a play-button picture: `patterns/play-labels/`.
- A line a site puts into its own text ("Follow us on Google", the words of a download button, "first appeared on", related links under a story): `patterns/boilerplate/`. `ANYWHERE` holds lines that are noise wherever they stand, `TRAILING` footers that count only in the second half of the text. A block, or a run of text between two `<br>`, goes only when its whole text is one of these lines.
- The label of a block that a script fills, such as "wird geladen …" or "Loading…", or the heading of a comment box ("What do you think so far?"): `patterns/loading/`.
- The heading of a table of contents that a script builds, such as "Table of Contents" or "Inhaltsverzeichnis": `patterns/contents/`. The heading goes only when no list of links follows it.

To support a new language, add a file next to the existing ones and list it in the folder's `index.ts`. Every language
is searched at once, because an article in one language can sit on a site in another.

Two rules need no list of words. `state-hidden` removes what Alpine shows only while a state that starts out `false` is true (`x-show="open"` inside `x-data="{ open: false }"`: hover cards, menus, dialogs), because a reader never flips that state. `empty-contents` removes a table-of-contents heading that has no list after it.

## Adding a rule

1. Create `noise/<name>.ts` or `embeds/<name>.ts` exporting a `ContentRule`.
2. Add it to `PAGE_RULES` in `content/index.ts`. Order matters only where noted there.
3. Add fixtures (below). The test fails for a rule without any.

## Fixtures

Every rule is tested against small HTML files in `server/test/fixtures/content/<rule name>/`:

- `<case>.input.html`: the markup of the case, as small as possible and written or shortened by hand. Do not commit a
  whole publisher page or article text.
- `<case>.expected.html`: what the rule must produce.

```bash
# write the input, then let the test create the missing expected file, read it, and commit both
UPDATE_FIXTURES=1 npx tsx --test server/test/contentRules.test.ts
```

## Trying a rule on real feeds

Real pages are the best test. Fetch some articles, run the extractor on them and compare the result with and without
your change; the per-rule counters in `stats` show which rule removed what and how often. A rule that fires on many
pages or on none deserves a second look.
