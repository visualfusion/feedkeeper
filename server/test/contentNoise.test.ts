import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanReaderHtml, cleanSnippet, derivedText, type NoiseStats } from "../src/feeds/contentNoise.js";

const BODY = [
  "The ministry confirmed on Tuesday that the new rules apply from the first of November, after months of consultation with the affected associations and several regional authorities.",
  "Operators have until the end of the year to adapt their systems; smaller providers may apply for an extension if they can show a concrete plan for the migration of their existing contracts.",
  "Critics argue that the timetable is too tight, while the ministry points to a transition period that was agreed with industry representatives during the summer negotiations.",
].map(text => `<p>${text}</p>`).join("");

const HEAD = '<ol data-k5a-pos="west_breadcrumb"><li><a href="https://example.test/">example</a></li><li><a href="https://example.test/news/">News</a></li>' +
  '<li><a href="https://example.test/news/series/">Series</a></li></ol>' +
  '<p><span><span>Stand: </span><time datetime="2026-10-14 08:54">14.10.2026, 08:54 Uhr</time></span></p>' +
  '<p><a href="#id-Comments">Kommentieren</a></p>';

test("the reader loses breadcrumbs, dateline and jump links but keeps what a publisher monetises", () => {
  const stats: NoiseStats = {};
  const html = HEAD + '<p><a href="https://example.test/follow">Uns auf Google folgen</a></p>' + BODY +
    '<p>Anzeige</p><p>Jetzt das Angebot entdecken (Affiliate-Link).</p><p>© dpa | 14.10.2026 06:43</p>' +
    '<p>Der Newsletter informiert Sie täglich. Hier geht’s zur Anmeldung!</p>';
  const cleaned = cleanReaderHtml(html, "Title", stats);
  assert.doesNotMatch(cleaned, /<ol/);
  assert.doesNotMatch(cleaned, /Stand:/);
  assert.doesNotMatch(cleaned, /#id-Comments/);
  for (const kept of ["Uns auf Google folgen", "Anzeige", "Affiliate-Link", "© dpa", "Newsletter informiert", "ministry confirmed"]) {
    assert.ok(cleaned.includes(kept), `reader should keep: ${kept}`);
  }
  assert.deepEqual(stats, { breadcrumb: 1, dateline: 1, "section-chip": 1 }, "the jump link is a short link before the text");
});

test("a headline repeated at the start of the body and player leftovers are removed from the reader", () => {
  const html = "<h1>Elon as Wario</h1><p>1:49 Something else plays Autoplay</p><p>Audiobeitrag</p>" + BODY;
  const cleaned = cleanReaderHtml(html, "Elon as Wario");
  assert.doesNotMatch(cleaned, /Elon as Wario/);
  assert.doesNotMatch(cleaned, /Autoplay|Audiobeitrag/);
  assert.match(cleaned, /ministry confirmed/);
});

test("consent placeholders of embedded content go with their companion lines only", () => {
  const html = BODY + "<div><p>Empfohlener redaktioneller Inhalt</p><p>An dieser Stelle findest du einen externen Inhalt von Reddit, der den Artikel ergänzt.</p>" +
    "<p>Reddit-Inhalte erlauben</p><p>Ich bin damit einverstanden, dass mir Inhalte von Reddit angezeigt werden.</p><p>Link zum Reddit-Inhalt</p></div>" +
    "<p>Ich bin damit einverstanden, dass dies ein normaler Satz im Artikel ist.</p>";
  const cleaned = cleanReaderHtml(html, null);
  assert.doesNotMatch(cleaned, /externen Inhalt|erlauben|Link zum Reddit/);
  assert.match(cleaned, /normaler Satz im Artikel/);
});

test("a language switcher is dropped but a sentence naming two languages is not", () => {
  const switcher = "<p>English 日本語 简体字 繁體字 Français Español</p>";
  assert.doesNotMatch(cleanReaderHtml(switcher + BODY, null), /日本語/);
  const sentence = "<p>The guide is available in English and Deutsch.</p>";
  assert.match(cleanReaderHtml(sentence + BODY, null), /available in English/);
});

test("html without noise is returned untouched", () => {
  assert.equal(cleanReaderHtml(BODY, "Title"), BODY);
});

test("derived text drops credits, calls to action, advertising and recommendation tails", () => {
  const html = "<p>Science 14.10.2026</p><figure><figcaption>Das ist der City-Adventskalender (Bildquelle: LEGO).</figcaption></figure>" + BODY +
    "<p>Click Here to Buy Now: $59 $90 ($31 off). Hurry, only a few left!</p>" +
    "<p>Wählen Sie FUTUREZONE als bevorzugte Google-Quelle</p>" +
    "<p>Facebook, Reddit, Google News, X, Threads</p><p>© dpa | 14.10.2026 06:43</p>" +
    "<p>Auch interessant:</p><p><a href='/a'>Another story</a></p><p><a href='/b'>And another one</a></p><p>Sales Manager B2B Recruiting GmbH in Düsseldorf</p>";
  const stats: NoiseStats = {};
  const text = derivedText(html, "Title", stats);
  assert.match(text, /ministry confirmed/);
  assert.match(text, /smaller providers may apply/);
  for (const dropped of ["Bildquelle", "Hurry", "bevorzugte Google-Quelle", "Threads", "© dpa", "Another story", "Sales Manager", "Science 14.10.2026"]) {
    assert.ok(!text.includes(dropped), `derived text should drop: ${dropped}`);
  }
  assert.ok(stats["recommendations"] >= 1 && stats["advertising"] >= 1 && stats["call-to-action"] >= 2 && stats["credit"] >= 1);
});

test("a label in the middle of an article only removes its own links", () => {
  const html = BODY + "<p>Aktuelle News:</p><p><a href='/x'>A related headline</a></p>" + BODY.replace(/ministry/g, "agency");
  const text = derivedText(html, null);
  assert.ok(!text.includes("A related headline"));
  assert.match(text, /agency confirmed/);
});

test("derived text keeps sentences that merely mention newsletters or credits inside the story", () => {
  const long = "<p>" + "Der Verlag hat den Newsletter abonniert und die Anmeldung für alle Leser gestrichen, weil die Zahl der Beschwerden stark gestiegen war und ein Teil der Abonnenten den Dienst nicht mehr nutzen wollte, wie das Unternehmen am Dienstag mitteilte. ".repeat(2) + "</p>";
  const text = derivedText(long + BODY, null);
  assert.match(text, /Newsletter abonniert/);
});

test("cleaning never leaves an article with nothing", () => {
  const onlyChrome = "<p>Anzeige</p><p>Auch interessant:</p><p>FTC: We use income earning auto affiliate links.</p>";
  const text = derivedText(onlyChrome + "<p>Short but real.</p>", null);
  assert.match(text, /Short but real/);
});

test("snippet footers of feed plugins are removed whatever the site", () => {
  const cases: [string, string, string | null][] = [
    ["Mit der kostenlosen App lassen sich Lautsprecher nutzen. […]\n★ iPhone-Ticker bei Google bevorzugen ★\nDer Beitrag Gratis-App bringt Durchsagen wurde zuerst auf iphone-ticker.de veröffentlicht.", "Gratis-App bringt Durchsagen", "Mit der kostenlosen App lassen sich Lautsprecher nutzen. […]"],
    ["Der neue HomePod mini 2 lässt sich nutzen […]\nDer Beitrag HomePod Mini 2 am Mac erschien zuerst auf appgefahren.de.", "HomePod Mini 2 am Mac", "Der neue HomePod mini 2 lässt sich nutzen […]"],
    ["Der Beitrag Kein Wind erschien zuerst beim Online-Magazin BASIC thinking. Über unseren Newsletter UPDATE startest du jeden Morgen bestens informiert in den Tag.\nWährend viele Nationen diskutieren […]\nDer Beitrag Kein Wind erschien zuerst auf BASIC thinking. Folge uns auch auf Google News und Flipboard oder abonniere unseren Newsletter UPDATE.", "Kein Wind", "Während viele Nationen diskutieren […]"],
    ["If you damage the hub, the fees are $39.\r\n\r\nRelated Roundup: Apple HomeView\nTag: AppleCare\nBuyer's Guide: HomeView (Buy Now)\nThis article, \"Repair Fees\" first appeared on MacRumors.com\nDiscuss this article in our forums", "Repair Fees", "If you damage the hub, the fees are $39."],
    ["Kyoto is full of temples.\nThe post Our 11 Favorites appeared first on Japan Cheapo.", "Our 11 Favorites", "Kyoto is full of temples."],
    ["An OpenAI engineer was arrested.\nRead the full story at The Verge.", "OpenAI", "An OpenAI engineer was arrested."],
    ["The ministry said Wednesday.\nRead full story here", "x", "The ministry said Wednesday."],
    ["Apple is asking a judge to overturn a verdict. Here are the details.\nmore…", "x", "Apple is asking a judge to overturn a verdict. Here are the details."],
    ["Zwei ehemalige Mitarbeiter erinnern sich.\n Mehr", "x", "Zwei ehemalige Mitarbeiter erinnern sich."],
    ["Moss has been on this planet for around 450 million years.", "Moss glows", "Moss has been on this planet for around 450 million years."],
    ["Yanko Moss glows\nMoss has been on this planet for around 450 million years...", "Yanko Moss glows", "Moss has been on this planet for around 450 million years..."],
    ["Vivid baut sein Angebot aus.\nZum Beitrag: Vivid\r\n\r\nWo du uns folgen kannst:\r\nFacebook, Reddit, Google News, X, Threads\r\n\r\n\r\n    Auf dem Laufenden bleiben?\r\n    \n\r\n    Fügt uns doch bei Google als bevorzugte Quelle hinzu!", "Vivid", "Vivid baut sein Angebot aus."],
    ["Kyoto isn’t just full of stunning temples.\n\n\t\t\t\t\n\t\t\t\t\t\tJump to:\n\t\t\t\t\t1. Aiyo!", "x", "Kyoto isn’t just full of stunning temples.\nJump to:\n1. Aiyo!"],
  ];
  for (const [input, title, expected] of cases) assert.equal(cleanSnippet(input, title), expected, input.slice(0, 40));
  assert.equal(cleanSnippet(null), null);
  assert.equal(cleanSnippet("The post Only Footer appeared first on Site."), "");
});

const STORY = "<p>Ein Feuerwerkskörper, ein Wohnungsbrand und am Ende der Tod einer Frau: Gut zehn Monate nach dem Feuer beginnt heute der Prozess gegen den mutmaßlichen Verursacher, dem fahrlässige Tötung vorgeworfen wird.</p>" +
  "<p>Die Rakete soll auf dem Balkon eines Mehrfamilienhauses gelandet sein und dort einen Brand ausgelöst haben, der sich bis zur Wohnung der Bewohnerin ausbreitete, wie die Staatsanwaltschaft mitteilte.</p>";

test("a broadcaster page head: caption twice, credit, tag list, audio label, separator, date, headline", () => {
  const caption = "Nach einem Balkonbrand war an Silvester eine Seniorin ums Leben gekommen.";
  const html = '<figure><img src="https://img.test/a.jpg"></figure>' +
    `<section><p>Bild</p><p>${caption}</p><p>Bildrechte: Bildrechte: Mona Böhm / BR</p></section>` +
    '<section><p>Schlagwörter</p><ul><li><a href="/s?q=Brand">Brand</a></li><li><a href="/s?q=Feuer">Feuer</a></li></ul></section>' +
    `<div><p><span>Bildrechte: Bildrechte: Mona Böhm / BR</span></p><p>Audiobeitrag</p><p>${caption}</p></div>` +
    '<section><div><p><time datetime="2026-10-14T07:10">14.10.2026, 07:10 Uhr</time></p><p>Audiobeitrag</p></div><div><!-- --> <p><span>&gt;</span></p></div>' +
    "<h2>Prozess gegen Mann nach Brand</h2>" + STORY + "</section>" +
    '<section><p><em>"Hier ist Bayern": Der Newsletter informiert Sie immer montags bis freitags zum Feierabend über das Wichtigste vom Tag in Ihrem privaten Postfach. </em><a href="/n">Hier geht’s zur Anmeldung!</a></p></section>';
  const reader = cleanReaderHtml(html, "Prozess gegen Mann nach Brand");
  assert.doesNotMatch(reader, /Audiobeitrag|<h2>|14\.10\.2026|&gt;|<p>Bild<\/p>/);
  assert.equal((reader.match(/Nach einem Balkonbrand/g) ?? []).length, 1);
  assert.equal((reader.match(/Mona Böhm/g) ?? []).length, 1);
  assert.match(reader, /Schlagwörter/);
  assert.match(reader, /Newsletter informiert/);

  const text = derivedText(html, "Prozess gegen Mann nach Brand");
  assert.ok(text.startsWith("Ein Feuerwerkskörper"), text.slice(0, 80));
  assert.doesNotMatch(text, /Schlagwörter|Brand Feuer|Bildrechte|Newsletter|Audiobeitrag/);
});

test("a games site: video card with its autoplay label and a consent block of an embedded post", () => {
  const html = '<p><span><picture><img src="https://img.test/z.jpg"></picture></span><span>Der Werbe-Zeppelin stammt von Goodyear.</span></p>' +
    STORY +
    '<p><span><a href="https://example.test/videos/a,1.html" data-videoid="1"><span><img src="https://static.test/play.svg" alt="Video starten"></span><span><i></i>14:39</span></a></span>' +
    '<a href="https://example.test/videos/a,1.html"><span>Wird GTA 6 jetzt zur Dating-Sim?</span></a></p><div><p><label for="toggle-autoplay-1">Autoplay</label></p></div>' +
    '<h2>So sieht der Marketing-Gag aus</h2><p>Ein Bild vom Zeppelin seht ihr zum Beispiel hier bei Reddit, wo ein User das Luftschiff gesehen hat:</p>' +
    '<div data-embed-type="reddit"><div><p>Empfohlener redaktioneller Inhalt</p><p>An dieser Stelle findest du einen externen Inhalt von Reddit, der den Artikel ergänzt.<br>Du kannst ihn dir mit einem Klick anzeigen lassen und wieder ausblenden.</p>' +
    '<div><p><label for="toggle-embed-reddit">Reddit-Inhalte erlauben</label></p></div><p>Ich bin damit einverstanden, dass mir Inhalte von Reddit angezeigt werden.</p>' +
    '<p>Personenbezogene Daten können an Drittplattformen übermittelt werden. Mehr dazu in unserer <a href="/datenschutz/">Datenschutzerklärung</a>.</p></div></div>' +
    '<p>Link zum <a href="https://reddit.test/r/1">Reddit-Inhalt</a></p>' + STORY;
  const reader = cleanReaderHtml(html, "GTA 6");
  assert.doesNotMatch(reader, /Autoplay|externen Inhalt|Reddit-Inhalte erlauben|Drittplattformen|Link zum/);
  assert.match(reader, /<a href="https:\/\/example\.test\/videos\/a,1\.html" data-media="video">Wird GTA 6 jetzt zur Dating-Sim\?<\/a>/);
  assert.doesNotMatch(reader, /14:39|play\.svg/, "the duration was part of the player, whose picture a reader cannot show");
  assert.match(reader, /So sieht der Marketing-Gag aus/);
  const text = derivedText(html, "GTA 6");
  assert.doesNotMatch(text, /14:39|Autoplay|Reddit-Inhalt/);
  assert.match(text, /Ein Bild vom Zeppelin/);
});

test("the reader keeps structure and emphasis but no fonts, sizes, colours or classes", () => {
  const html = '<div class="article" style="font-family: Georgia"><h2 style="font-size: 30px">Heading</h2>' +
    '<p style="text-align: justify; color: #333" class="lead"><font face="Arial" size="4"><b>Bold</b> and <i>italic</i> text</font> with ' +
    '<span style="font-weight: bold; font-size: 14px">styled bold</span> and <span style="font-style: italic">styled italic</span>.</p>' +
    '<p align="center"><big>Big</big> <small>small</small> <u>underlined</u></p>' +
    '<table width="600" border="1"><tr><td width="50%" bgcolor="#eee">Cell</td></tr></table>' +
    '<img src="https://img.test/a.jpg" width="640" height="360" alt="A" style="float:left">' +
    '<style>p { font-size: 40px }</style><p id="note-1"><span id="fn">Footnote</span> <a href="#fn">1</a></p></div>';
  const cleaned = cleanReaderHtml(html, null);
  assert.doesNotMatch(cleaned, /style=|class=|face=|size=|color=|align=|bgcolor=|border=|<font|<span id="x"|<big|<small|<u>|<style/i);
  assert.match(cleaned, /<h2>Heading<\/h2>/);
  assert.match(cleaned, /<b>Bold<\/b> and <i>italic<\/i> text/);
  assert.match(cleaned, /<strong>styled bold<\/strong>/);
  assert.match(cleaned, /<em>styled italic<\/em>/);
  assert.match(cleaned, /<img src="https:\/\/img.test\/a.jpg" width="640" height="360" alt="A">/);
  assert.match(cleaned, /<table><tbody><tr><td>Cell<\/td>/);
  assert.match(cleaned, /<span id="fn">Footnote<\/span>/);
});

test("tracking attributes and unused ids are dropped while links, rel and lazy sources stay", () => {
  const html = '<p id="intro" data-id-ec="{&quot;a&quot;:1}" aria-label="x" role="note" onclick="track()">See <a href="https://shop.test/p?aff=1" rel="sponsored noopener" target="_blank" data-trk-label="x" aria-hidden="false">the offer</a> and <a href="#fn1">a note</a>.</p>' +
    '<h2 id="topic">Topic</h2><p id="fn1">Footnote</p><img src="data:image/gif;base64,R0lGOD" data-src="https://img.test/real.jpg" data-nimg="fill" alt="Real">';
  const cleaned = cleanReaderHtml(html, null);
  assert.doesNotMatch(cleaned, /data-id-ec|aria-|role=|onclick|data-trk|data-nimg|id="intro"|id="topic"/);
  assert.match(cleaned, /id="fn1"/);
  assert.match(cleaned, /rel="sponsored noopener"/);
  assert.match(cleaned, /target="_blank"/);
  assert.match(cleaned, /data-src="https:\/\/img.test\/real.jpg"/);
});

test("a section chip and a standalone date before the first paragraph are dropped, a short link later is not", () => {
  const lead = "<p>Der Widerstand gegen Künstliche Intelligenz und die dafür gebauten Rechenzentren nimmt stetig zu, wie mehrere Berichte zeigen.</p>";
  const head = '<p><a href="/netzpolitik">Netzpolitik</a></p><p>14.10.2026</p>';
  const cleaned = cleanReaderHtml(head + lead + '<p><a href="/mehr">Mehr dazu</a></p>', null);
  assert.doesNotMatch(cleaned, /Netzpolitik|14\.10\.2026/);
  assert.match(cleaned, /Widerstand gegen/);
  assert.match(cleaned, /Mehr dazu/);
});

test("a wrapper element's picture address replaces the placeholder image inside it", () => {
  const html = `<figure><a-img alt="Portrait" src="/imgs/71/portrait.png" width="810"><img alt="Portrait" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E" width="810"></a-img><figcaption>Portrait</figcaption></figure><p>Text</p>`;
  const stats: Record<string, number> = {};
  const cleaned = cleanReaderHtml(html, null, stats);
  assert.match(cleaned, /<img[^>]*src="\/imgs\/71\/portrait\.png"/);
  assert.doesNotMatch(cleaned, /a-img|data:image/);
  assert.match(cleaned, /<figcaption>Portrait<\/figcaption>/);
  assert.equal(stats["custom-image"], 1);
  const bare = cleanReaderHtml(`<p><a-img alt="Chart" src="https://cdn.example.test/chart.png"></a-img></p><p>More text here.</p>`);
  assert.match(bare, /<img[^>]*src="https:\/\/cdn\.example\.test\/chart\.png"[^>]*>/);
  assert.equal(cleanReaderHtml(`<p><img src="/photo.jpg"></p>`), `<p><img src="/photo.jpg"></p>`);
});

test("a link that holds one badge in two colour schemes keeps its label as text instead of two large images", () => {
  const stats: NoiseStats = {};
  const badge = '<p><a target="_blank" rel="nofollow" href="https://google.com/preferences/source?q=https://example.test" aria-label="Add Example as a preferred source on Google">' +
    '<img src="https://example.test/theme/badge-dark.png" alt="Add Example as a preferred source on Google">' +
    '<img src="https://example.test/theme/badge-light.png" alt="Add Example as a preferred source on Google"></a></p>';
  const html = BODY + '<ul><li><a href="https://amzn.to/x">Affiliate item</a></li></ul>' + badge + '<p><em>FTC: We use income earning auto affiliate links.</em></p>';
  const cleaned = cleanReaderHtml(html, "Title", stats);
  assert.doesNotMatch(cleaned, /badge-(dark|light)\.png/);
  assert.match(cleaned, /<a [^>]*href="https:\/\/google\.com\/preferences\/source[^"]*"[^>]*>Add Example as a preferred source on Google<\/a>/);
  for (const kept of ["Affiliate item", "FTC: We use income earning", "ministry confirmed"]) assert.match(cleaned, new RegExp(kept));
  assert.equal(stats["image-variants"], 1);
});

test("links with one image, with different images or with text next to the images stay as they are", () => {
  const same = '<a href="https://example.test/a"><img src="https://example.test/a.png" alt="Logo"></a>';
  const different = '<a href="https://example.test/b"><img src="https://example.test/1.png" alt="Front"><img src="https://example.test/2.png" alt="Back"></a>';
  const withText = '<a href="https://example.test/c"><img src="https://example.test/3.png" alt="Pic"><img src="https://example.test/4.png" alt="Pic"> Gallery</a>';
  const cleaned = cleanReaderHtml(BODY + `<p>${same}</p><p>${different}</p><p>${withText}</p>`, "Title");
  for (const src of ["a.png", "1.png", "2.png", "3.png", "4.png"]) assert.match(cleaned, new RegExp(src.replace(".", "\\.")));
});

test("variants without a label collapse to the first image", () => {
  const html = BODY + '<p><a href="https://example.test/s"><img src="https://example.test/dark.png"><img src="https://example.test/light.png"></a></p>';
  const cleaned = cleanReaderHtml(html, "Title");
  assert.match(cleaned, /dark\.png/);
  assert.doesNotMatch(cleaned, /light\.png/);
});

test("structured data standing as text and a lone date or reading time near the start do not reach the reader", () => {
  const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "ImageObject", url: "https://example.test/a.jpg", caption: "Ein Airbus über der Landebahn" });
  const stats: NoiseStats = {};
  const html = '<header><p>Die Lufthansa hat ihrem ersten Airbus einen Namen gegeben. Der Langstreckenjet kommt Mitte November nach München, sein erster Linienflug ist für Dezember geplant.</p>' +
    '<p>15. Oktober 2026, 10:51 Uhr</p><custom-list :article="1"><p>2 min</p></custom-list>' +
    `<figure><img src="https://example.test/a.jpg" alt="x"><figcaption>Ein Airbus über der Landebahn</figcaption><component :is="'script'" type="application/ld+json">${ld}</component></figure></header>` +
    `<div>${ld}</div>` + BODY + '<p>Der Termin steht für den 3. Dezember 2026 fest, wie die Fluggesellschaft mitteilte.</p>';
  const cleaned = cleanReaderHtml(html, "Title", stats);
  assert.doesNotMatch(cleaned, /@context|schema\.org/);
  assert.doesNotMatch(cleaned, /15\. Oktober 2026/);
  assert.doesNotMatch(cleaned, />2 min</);
  for (const kept of ["Die Lufthansa hat ihrem ersten Airbus", "Ein Airbus über der Landebahn", "ministry confirmed", "Der Termin steht für den 3. Dezember 2026 fest"]) assert.match(cleaned, new RegExp(kept));
  assert.equal(stats["structured-data"], 2);
  assert.equal(stats["dateline"], 1);
  assert.equal(stats["reading-time"], 1);
});

test("dates and reading times inside the story stay", () => {
  const body = BODY + `<p>${"Weiterer Absatz mit ausreichend Text. ".repeat(25)}</p>` + '<p>Am 15. Oktober 2026 fiel die Entscheidung, die Frist läuft bis zum 3. Dezember 2026.</p><p>5 min</p><p>Oct 15, 2026</p>';
  const cleaned = cleanReaderHtml(body, "Title");
  assert.match(cleaned, /Am 15\. Oktober 2026 fiel die Entscheidung/);
  assert.match(cleaned, />5 min</, "far from the start a line like this may be part of the story");
  assert.match(cleaned, />Oct 15, 2026</);
});

test("a product card whose picture is a CSS background and whose price is a snapshot is dropped with its label", () => {
  const stats: NoiseStats = {};
  const card = '<div id="preview"><div class="header"><span>Produkthinweis</span></div><div class="content">' +
    '<div style="background: url(\'https://m.example.test/i/hue.jpg\') center center no-repeat; background-size: cover;"></div>' +
    '<div><span><a href="https://www.amazon.de/dp/B0FKH9CD5C?tag=x">Philips Hue Bridge Pro</a></span><span>88,89 EUR</span><span>99,99 EUR</span></div></div></div>';
  const html = BODY + card + '<p>Mehr dazu in der App-Beschreibung, die sich ausführlich mit den neuen Funktionen und der Bedienung beschäftigt.</p>' + card +
    '<p>Dieser Artikel enthält Affiliate-Links. Wer darüber einkauft unterstützt uns mit einem Teil des unveränderten Kaufpreises. <a href="https://example.test/affiliate">Was ist das?</a></p>';
  const cleaned = cleanReaderHtml(html, "Title", stats);
  assert.doesNotMatch(cleaned, /Produkthinweis|Philips Hue|88,89|hue\.jpg/);
  for (const kept of ["ministry confirmed", "Mehr dazu in der App-Beschreibung", "Dieser Artikel enthält Affiliate-Links", "Was ist das?"]) assert.match(cleaned, new RegExp(kept));
  assert.equal(stats["product-card"], 2);
});

test("an image with a background inside a long text, or a price without a card, stays", () => {
  const shell = '<div style="background: url(https://example.test/hero.jpg)"></div>';
  const long = BODY + `<div>${shell}<p>${"Ein langer Absatz über die Preise. ".repeat(12)} Der Preis liegt bei 99 EUR. <a href="https://example.test/a">Mehr</a></p></div>`;
  assert.match(cleanReaderHtml(long, "Title"), /Der Preis liegt bei 99 EUR/);
  assert.match(cleanReaderHtml(BODY + '<p>Das Gerät kostet 199 EUR, mehr unter <a href="https://example.test/p">diesem Link</a>.</p>', "Title"), /kostet 199 EUR/);
});

const GAMESTAR_PLAYER = '<p><span><a href="https://www.gamestar.de/videos/wildwood,142205.html" data-videoid="142205" title="Wildwood im Trailer">' +
  '<span><span><img src="https://static.example.test/assets/images/play_icon.svg" alt="Video starten"></span><span><i></i>2:27</span></span></a></span>' +
  '<a href="https://www.gamestar.de/videos/wildwood,142205.html" title="Wildwood im Trailer"><span>Wildwood im Trailer</span></a></p>';

test("a player's play-button picture goes and its two links to the same video become one marked link", () => {
  const stats: NoiseStats = {};
  const cleaned = cleanReaderHtml(BODY + GAMESTAR_PLAYER, "Title", stats);
  assert.doesNotMatch(cleaned, /play_icon|2:27|<img/);
  assert.equal(cleaned.match(/<a /g)?.length, 1);
  assert.match(cleaned, /<a href="https:\/\/www\.gamestar\.de\/videos\/wildwood,142205\.html" title="Wildwood im Trailer" data-media="video">Wildwood im Trailer<\/a>/);
  assert.equal(stats["video"], 1);
});

test("a script-driven player button without an address is left out with its label", () => {
  const player = '<h3>Hier der zweite Trailer:</h3><div role="button" tabindex="0"><p>Watchmen - Trailer 2 (Deutsch)</p>' +
    '<p><img src="https://example.test/_next/static/abc.svg" alt="Abspielen" width="70" height="70"></p></div>';
  const cleaned = cleanReaderHtml(BODY + player + "<p>Die Handlung spielt im Jahr 1985, in dem Richard Nixon noch immer Präsident ist.</p>", "Title");
  assert.doesNotMatch(cleaned, /Watchmen|Abspielen|<img|role=/);
  assert.match(cleaned, /Hier der zweite Trailer/);
  assert.match(cleaned, /Richard Nixon/, "the article text around the player stays");
});

test("embedded players of the common video sites become a link, other embeds are left as they are", () => {
  const stats: NoiseStats = {};
  const html = BODY + '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" title="Ein Clip" width="560"></iframe></div>' +
    '<iframe src="//player.vimeo.com/video/12345"></iframe><iframe src="https://www.example.test/widget"></iframe>' +
    '<video controls><source src="https://cdn.example.test/clip.mp4" type="video/mp4"></video>';
  const cleaned = cleanReaderHtml(html, "Title", stats);
  assert.match(cleaned, /<a href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ" data-media="video">Ein Clip<\/a>/);
  assert.match(cleaned, /<a href="https:\/\/vimeo\.com\/12345" data-media="video">Vimeo<\/a>/);
  assert.match(cleaned, /<a href="https:\/\/cdn\.example\.test\/clip\.mp4" data-media="video">Video<\/a>/);
  assert.match(cleaned, /<iframe src="https:\/\/www\.example\.test\/widget"/);
  assert.doesNotMatch(cleaned, /youtube-nocookie|<source|<video/);
  assert.equal(stats["video"], 3);
});

test("pictures that merely have a play-like name inside running text are not taken for a player", () => {
  const html = BODY + '<p>Das <img src="https://example.test/photo.jpg" alt="Playstation 5"> ist zu sehen.</p>';
  const cleaned = cleanReaderHtml(html, "Title");
  assert.match(cleaned, /Playstation 5/);
});

test("a byline keeps its author and loses the date the reader already shows in its head", () => {
  const stats: NoiseStats = {};
  const html = '<p>von <a href="https://example.test/autor">Michael Bartl</a> I 15.10.2026 - 11:41</p>' + BODY + `<p>${"Wort ".repeat(220)}</p>` +
    "<p>von Anna Beispiel I 15.10.2026 - 11:41</p>";
  const cleaned = cleanReaderHtml(html, "Title", stats);
  assert.match(cleaned, /^<p>von <a href="https:\/\/example\.test\/autor">Michael Bartl<\/a><\/p>/);
  assert.match(cleaned, /<p>von Anna Beispiel I 15\.10\.2026 - 11:41<\/p>/, "far from the start the line stays");
  assert.equal(stats["byline-date"], 1);
  assert.match(cleanReaderHtml("<p>Heute von Meier | 3. Mai 2026</p>" + BODY, "Title"), /Meier \| 3\. Mai 2026/, "only lines that begin as a byline");
});

test("standalone inline bylines lose repeated metadata in feed and extracted reader HTML", () => {
  const byline = 'von <a href="https://example.test/author">Hannes Könitzer</a> I 16.10.2026 - 12:14';
  const cases = [
    `<span class="submitted-by">von Hannes Könitzer I 16.10.2026 - 12:14</span><div>${BODY}</div>`,
    `<div><article><header><span property="dc:title" content="Title"></span></header><span>${byline}</span><div>${BODY}</div></article></div>`,
  ];
  for (const html of cases) {
    const stats: NoiseStats = {};
    const cleaned = cleanReaderHtml(html, "Title", stats, "Hannes Könitzer");
    assert.doesNotMatch(cleaned, /Hannes Könitzer|16\.10\.2026|12:14/);
    assert.match(cleaned, /ministry confirmed/);
    assert.equal(stats.byline, 1);
    assert.equal(cleanReaderHtml(cleaned, "Title", {}, "Hannes Könitzer"), cleaned);
  }
  const withoutAuthor = cleanReaderHtml(`<article><span>${byline}</span><div>${BODY}</div></article>`, "Title");
  assert.match(withoutAuthor, /Hannes Könitzer/);
  assert.doesNotMatch(withoutAuthor, /16\.10\.2026|12:14/);
});

test("inline author mentions inside prose and bylines far into the story are preserved", () => {
  const mention = '<span>von Hannes Könitzer I 16.10.2026 - 12:14</span>';
  for (const html of [
    `<p>Eine Meldung ${mention} wird hier besprochen.</p>${BODY}`,
    `<div>Eine Meldung ${mention} wird hier besprochen.${BODY}</div>`,
    `<div><strong>Eine Meldung </strong>${mention}<em> wird hier besprochen.</em>${BODY}</div>`,
    `${BODY}<p>${"More editorial text. ".repeat(50)}</p>${mention}`,
  ]) {
    assert.match(cleanReaderHtml(html, "Title", {}, "Hannes Könitzer"), /Hannes Könitzer I 16\.10\.2026 - 12:14/);
  }
});

test("a comment-rules block at the end of an article is left out of the reader with everything below it", () => {
  const stats: NoiseStats = {};
  const html = "<div>" + BODY + "<p>Der Film startet am 11. März 2027.</p><h2>Regeln für Kommentare:</h2><p>1. Seid nett zueinander.</p>" +
    "<p><strong>Nur angemeldete Benutzer können kommentieren.</strong></p></div>";
  const cleaned = cleanReaderHtml(html, "Title", stats);
  assert.match(cleaned, /startet am 11\. März 2027/);
  assert.doesNotMatch(cleaned, /Regeln für Kommentare|Seid nett|angemeldete/);
  assert.equal(stats["comment-rules"], 1);
  const middle = cleanReaderHtml("<h2>Kommentarregeln</h2>" + BODY + "<p>" + "Wort ".repeat(400) + "</p>", "Title");
  assert.match(middle, /Kommentarregeln/, "a heading with plenty of text after it is not a footer");
});

test("an ad label with no ad behind it goes, an ad with content keeps its label", () => {
  const stats: NoiseStats = {};
  const bare = cleanReaderHtml(BODY + "<p>Anzeige</p><h3>Auch interessant:</h3><ul><li><a href=\"https://example.test/a\">Ein anderer Artikel</a></li></ul>", "Title", stats);
  assert.doesNotMatch(bare, /Anzeige/);
  assert.match(bare, /Auch interessant/);
  assert.equal(stats["empty-ad-label"], 1);
  const sponsored = cleanReaderHtml(BODY + '<p>Anzeige</p><p><a href="https://shop.test/x"><img src="https://shop.test/x.jpg" alt="Angebot"></a></p>', "Title");
  assert.match(sponsored, /Anzeige/);
  assert.match(cleanReaderHtml(BODY + "<p>Anzeige</p><p>Jetzt das Angebot entdecken (Affiliate-Link).</p>", "Title"), /Anzeige/, "text that follows is the ad");
});

test("the English forms of byline, comment rules and ad label are handled like the German ones", () => {
  const body = `<p>${"A long paragraph with plenty of text. ".repeat(8)}</p>`;
  assert.doesNotMatch(cleanReaderHtml("<p>By Anna Muster | Oct 15, 2026</p>" + body, "T"), /2026/);
  assert.match(cleanReaderHtml("<p>By Anna Muster | Oct 15, 2026</p>" + body, "T"), /By Anna Muster/);
  assert.doesNotMatch(cleanReaderHtml(body + "<h3>Comment Policy</h3><p>Be kind.</p>", "T"), /Policy|Be kind/);
  assert.doesNotMatch(cleanReaderHtml(body + "<h3>Community guidelines:</h3><p>Be kind.</p>", "T"), /guidelines/);
  for (const label of ["Advertisement", "Sponsored", "Sponsored content", "Ad", "Paid content"]) {
    assert.doesNotMatch(cleanReaderHtml(body + `<p>${label}</p><h3>Related</h3><ul><li><a href="https://example.test/a">Another story</a></li></ul>`, "T"), new RegExp(`<p>${label}</p>`), label);
  }
});

test("long product cards do not leave an orphan header in German, English or Japanese", () => {
  for (const label of ["Produkthinweis", "Produktempfehlung", "Product notice", "Product recommendation", "商品紹介", "商品案内", "製品紹介"]) {
    const name = "XREAL One Pro AR Brille mit X1 Chip, 171 Zoll 120Hz HD Display, Native 3DoF XR Brille 57 Grad Sichtfeld, X-Prism Optik und weiteres Zubehör".padEnd(205, "X");
    const content = `<div><div style="background: url(https://shop.test/product.jpg)"></div><div><a href="https://shop.test/product">${name}</a><span>599,00 EUR</span></div></div>`;
    const html = BODY + `<div><div><span>${label}</span></div>${content}</div><p>Dieser Artikel enthält Affiliate-Links.</p>`;
    const cleaned = cleanReaderHtml(html, "Title");
    assert.ok(!cleaned.includes(label), label);
    assert.doesNotMatch(cleaned, /XREAL|599,00/);
    assert.match(cleaned, /Dieser Artikel enthält Affiliate-Links/);
    assert.match(cleanReaderHtml(BODY + `<h2>${label}</h2><p>Ein redaktioneller Produkttest mit echten Informationen.</p>`, "Title"), new RegExp(label));
  }
});

test("empty nested ad slots disappear between story paragraphs in multiple languages", () => {
  for (const label of ["Anzeige", "Werbung", "Advertisement", "Advertising", "Ad", "Sponsored content", "広告", "広告掲載", "スポンサー記事", "PR"]) {
    const before = "Vor dem leeren Werbeplatz steht ein normaler Artikelabsatz.";
    const after = "Nach dem leeren Werbeplatz geht der Artikel unverändert weiter.";
    const slot = `<div class="ad"><span></span><div><div><font size="1">${label}</font><div id="slot"></div></div></div></div>`;
    const cleaned = cleanReaderHtml(BODY + `<p>${before}</p>${slot}<p>${after}</p>`, "Title");
    assert.ok(!cleaned.includes(label), label);
    assert.ok(cleaned.includes(before) && cleaned.includes(after));
    for (const ad of [
      '<a href="https://shop.test/ad">Jetzt kaufen / Buy now / 今すぐ購入</a>',
      '<img src="https://shop.test/ad.jpg">', '<iframe src="https://shop.test/ad"></iframe>',
      '<p>Ein gesponserter Beitrag. Sponsored article. スポンサーによる記事です。</p>',
    ]) {
      assert.ok(cleanReaderHtml(BODY + `<div>${label}<div></div>${ad}</div>`, "Title").includes(label), `${label}: ${ad}`);
    }
    assert.ok(cleanReaderHtml(BODY + `<p>${label}</p><p>Sponsored article / gesponserter Beitrag / 提供記事</p>`, "Title").includes(label));
  }
});

test("identical adjacent desktop and mobile photos collapse without losing surrounding text", () => {
  const image = '<img src="https://pictures.test/story.png" srcset="https://pictures.test/story.png?=1x 1x, https://pictures.test/story.png?=2x 2x" alt="">';
  for (const pair of [image + image, `<div>${image}</div><div>${image}</div>`, image + image + image, `<picture>${image}${image}</picture>`]) {
    const stats: NoiseStats = {};
    const cleaned = cleanReaderHtml(BODY + pair + '<p>Die Handlung geht hier weiter.</p>', "Title", stats);
    assert.equal((cleaned.match(/<img /g) ?? []).length, 1);
    assert.match(cleaned, /Die Handlung geht hier weiter/);
    assert.ok(stats["duplicate-image"] >= 1);
  }
});

test("image identity preserves query parameters, origins, paths, captions and editorial repetitions", () => {
  const image = '<img src="https://pictures.test/a/photo.jpg?id=1" alt="Photo">';
  for (const other of [
    '<img src="https://pictures.test/a/photo.jpg?id=2" alt="Photo">',
    '<img src="https://other.test/a/photo.jpg?id=1" alt="Photo">',
    '<img src="https://pictures.test/b/photo.jpg?id=1" alt="Photo">',
    '<img src="https://pictures.test/a/photo.jpg?id=1" alt="Different caption">',
    '<img src="https://pictures.test/a/photo.jpg?id=1" alt="Photo" srcset="https://pictures.test/other.jpg 2x">',
    `<p>Ein erklärender Absatz.</p>${image}`, `<figcaption>Bildunterschrift / Caption / 写真説明</figcaption>${image}`,
    `<video src="https://pictures.test/movie.mp4"></video>${image}`,
  ]) assert.equal((cleanReaderHtml(BODY + image + other, "Title").match(/<img /g) ?? []).length, 2, other);
  const links = `<a href="https://example.test/one">${image}</a><a href="https://example.test/two">${image}</a>`;
  assert.equal((cleanReaderHtml(BODY + links, "Title").match(/<img /g) ?? []).length, 2);
});


test("labels left in otherwise empty wrappers after extraction are removed without stripping disclosures", () => {
  for (const label of ["Anzeige", "Advertisement", "広告", "Produkthinweis", "Product notice", "商品紹介"]) {
    const html = BODY + `<div><p><span>${label}</span></p></div><p>Hier geht der redaktionelle Text weiter.</p>`;
    assert.ok(!cleanReaderHtml(html, "Title").includes(label), label);
  }
  for (const label of ["Sponsored content", "Paid content", "Advertorial", "Gesponsert", "スポンサー記事", "PR"]) {
    const html = BODY + `<div><p>${label}</p></div><p>Der zugehörige gesponserte Artikel.</p>`;
    assert.ok(cleanReaderHtml(html, "Title").includes(label), label);
  }
});
