# Full-text fetching

Reader requests, background preparation, saved articles and API integrations share one planner. Results belong to the article, so subscribers reuse the same extraction. Saving a new link uses the same network and host limits.

The planner keeps up to 1,000 article jobs in SQLite and refills background work continuously. Opening an article has priority over explicit preparation, active editions, saved articles and other background work. Waiting jobs gain priority with age; background selection also favours older articles. A busy host does not prevent another host from running.

## Settings

All settings take effect after restarting the process. Invalid values stop startup when the planner is initialized.

| Variable | Default | Allowed |
| --- | ---: | ---: |
| `FULLTEXT_CONCURRENCY` | 2 | 1–8 |
| `FULLTEXT_HOST_CONCURRENCY` | 1 | 1–4 |
| `FULLTEXT_MAX_WAITING` | 32 | 0–128 |
| `FULLTEXT_TIMEOUT_MS` | 20000 | 50–60000 |
| `FULLTEXT_AGING_MS` | 60000 | 50–600000 |

Start with the defaults. On a small host, use one extraction at a time. Keep host concurrency at one unless the sources explicitly allow more. Feed polling and image downloads have separate limits, so increasing all three together can consume much more memory and CPU.

The extraction deadline includes admission waiting, fetching and redirects; the HTTP stage also has a 12-second deadline. Parsing runs on the Node event loop, with a 2 MiB HTML limit; a timer cannot interrupt synchronous parsing or the operating system's pending DNS lookup. At most 64 HTTP consumers may wait for article results. They receive an overload response beyond that limit and time out after 30 seconds. A consumer timeout leaves the durable job intact. Concurrent consumers join the same article job; access is checked again before delivery.

Transient failures get at most two additional attempts with exponential backoff and jitter. HTTP 429/503 and valid `Retry-After` values delay the source host. Waiting for a retry uses no worker. Redirects also obey the destination host budget. Paywalls and consent walls keep their existing longer retry policy; shorter extraction results never replace better stored content.

## Operation

Run **one application process per database**. The job table survives shutdown, but active ownership is process-local. Multiple replicas need a different claim protocol and are not supported. Normal shutdown aborts active requests and leaves unfinished jobs available after restart.

The aggregate `fulltext_queue` log includes queued/running/waiting work, waiting consumers, completions, failures, retries, throttling, rejections, total extraction duration and the oldest job's wait. It contains no source addresses, credentials or article contents. Compare these counters with feed lag, process memory and API latency before raising concurrency.

Before upgrading, back up the database and stop the old process. Migration 0033 adds job age, retry state and host cooldowns. Start with the defaults and observe a full polling cycle. To roll back, stop the application and run the previous version with its previous settings. The additive columns and table may remain; keep the backup for a full restore. Older releases ignore saved host cooldowns, so wait out active source pauses before reverting. Do not run old and new processes together.

## Page chrome in articles

Publisher pages put navigation and promotion inside the article body: breadcrumbs, a repeated headline and date line, player labels, consent placeholders for embedded posts, follow prompts, recommendation lists. FeedKeeper removes it in two layers with different rules, and never changes what is stored.

**What a reader shows** (`contentHtml` and `fullTextHtml`) loses only what cannot work in a reader or repeats what the reader already shows: breadcrumbs, in-page jump links, a standalone date line, the headline repeated at the start, separator and media labels, language switchers, consent placeholders of embedded content and verbatim repeats near the start. Credits, disclosures, sponsored and affiliate content and a publisher's own calls to action stay. A source's revenue model is not ours to remove.

**Derived text** (`snippet`, the text format of MCP `get_item`, and the text handed to edition curation) is never shown as a page, so noise there only costs relevance. It additionally drops credit and agency lines, captions, tag lists, advertising and affiliate notices, calls to action (newsletter, social, "preferred source"), comment prompts and recommendation tails. A heading such as "Related stories" in the last part of an article removes everything after it. Snippets also lose the footers feed plugins append ("The post … appeared first on …").

The reader HTML also carries no typography: fonts, sizes, colours, alignment, classes and presentational tags are removed, because the client sets the type. Structure (headings, paragraphs, lists, quotes, tables, links, images) and emphasis (bold, italic) are kept; emphasis that was only an inline style becomes `strong` or `em`.

**Lead.** Every item carries a `lead` (advertised as `item.lead`): the first 600 characters or so of the derived text, cut at a sentence. It is stored when content is written and derived again when the rules change, so clients can show a teaser without working it out from the HTML.

**Author.** An item carries the `author` its feed names (`dc:creator`, RSS `author`, Atom `author`; advertised as `item.author`), cleaned and joined by commas when there are several. Addresses without a name, generic names (`admin`, `editorial staff`) and the publication's own name are left out. A byline in the article text that only repeats the author is left out of the reader's HTML, because clients show the name beside the date. Items get their author on the next poll of their feed.

The rules are structural or generic idioms in `server/src/feeds/contentNoise.ts`. A phrase is added only when more than one publisher uses it, and every rule has a fixture. Cleaning never leaves an article empty: if almost nothing would remain, the text is returned as it was.
