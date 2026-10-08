import type { Localized } from "../extensions/host.ts";

export interface StarterFeed {
  title: string;
  /** The feed address; subscribing goes through the normal subscribe call, so redirects and discovery still apply. */
  url: string;
  /** Language of the feed's content (`de`, `en`, `ja`, …). */
  lang: string;
}

export interface StarterPack {
  id: string;
  title: Localized;
  description: Localized;
  feeds: StarterFeed[];
}

/**
 * A small, hand-picked set of well-known feeds to start with. Every address was checked to serve a feed; keep the list
 * short, because each entry has to be maintained. Operators can add packs or replace the list (`extensions.starterPacks`).
 */
export const BUILT_IN_STARTER_PACKS: StarterPack[] = [
  {
    id: "news",
    title: { en: "News", de: "Nachrichten", ja: "ニュース" },
    description: { en: "Headlines from public broadcasters and newspapers.", de: "Schlagzeilen von öffentlich-rechtlichen Sendern und Zeitungen.", ja: "放送局や新聞社の主要ニュース。" },
    feeds: [
      { title: "Tagesschau", url: "https://www.tagesschau.de/index~rss2.xml", lang: "de" },
      { title: "Deutschlandfunk Nachrichten", url: "https://www.deutschlandfunk.de/nachrichten-100.rss", lang: "de" },
      { title: "ZEIT ONLINE", url: "https://newsfeed.zeit.de/index", lang: "de" },
      { title: "DER SPIEGEL", url: "https://www.spiegel.de/schlagzeilen/index.rss", lang: "de" },
      { title: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", lang: "en" },
      { title: "The Guardian – World", url: "https://www.theguardian.com/world/rss", lang: "en" },
      { title: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", lang: "en" },
      { title: "NHK 主要ニュース", url: "https://www.nhk.or.jp/rss/news/cat0.xml", lang: "ja" },
      { title: "NHK 国際", url: "https://www3.nhk.or.jp/rss/news/cat6.xml", lang: "ja" },
      { title: "朝日新聞デジタル", url: "https://www.asahi.com/rss/asahi/newsheadlines.rdf", lang: "ja" },
    ],
  },
  {
    id: "technology",
    title: { en: "Technology", de: "Technik", ja: "テクノロジー" },
    description: { en: "News and background on software, hardware and the web.", de: "Nachrichten und Hintergründe zu Software, Hardware und Netz.", ja: "ソフトウェア、ハードウェア、ウェブのニュースと解説。" },
    feeds: [
      { title: "heise online", url: "https://www.heise.de/rss/heise-atom.xml", lang: "de" },
      { title: "Golem.de", url: "https://www.golem.de/rss.php?feed=RSS2.0", lang: "de" },
      { title: "netzpolitik.org", url: "https://netzpolitik.org/feed/", lang: "de" },
      { title: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", lang: "en" },
      { title: "The Verge", url: "https://www.theverge.com/rss/index.xml", lang: "en" },
      { title: "Hacker News", url: "https://hnrss.org/frontpage", lang: "en" },
      { title: "ITmedia", url: "https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml", lang: "ja" },
      { title: "GIGAZINE", url: "https://gigazine.net/news/rss_2.0/", lang: "ja" },
      { title: "Publickey", url: "https://www.publickey1.jp/atom.xml", lang: "ja" },
      { title: "ギズモード・ジャパン", url: "https://www.gizmodo.jp/index.xml", lang: "ja" },
    ],
  },
  {
    id: "apple",
    title: { en: "Apple", de: "Apple", ja: "Apple" },
    description: { en: "iPhone, Mac and everything around them.", de: "iPhone, Mac und alles drumherum.", ja: "iPhone、Macとその周辺の話題。" },
    feeds: [
      { title: "iPhone-Ticker", url: "https://www.iphone-ticker.de/feed/", lang: "de" },
      { title: "apfelpatient", url: "https://www.apfelpatient.de/feed", lang: "de" },
      { title: "Macerkopf", url: "https://www.macerkopf.de/feed/", lang: "de" },
      { title: "ifun.de", url: "https://www.ifun.de/feed/", lang: "de" },
      { title: "MacTechNews", url: "https://www.mactechnews.de/Rss/News.x", lang: "de" },
      { title: "Daring Fireball", url: "https://daringfireball.net/feeds/main", lang: "en" },
      { title: "MacStories", url: "https://www.macstories.net/feed/", lang: "en" },
      { title: "MacRumors", url: "https://feeds.macrumors.com/MacRumors-All", lang: "en" },
      { title: "9to5Mac", url: "https://9to5mac.com/feed/", lang: "en" },
      { title: "iPhone Mania", url: "https://iphone-mania.jp/feed/", lang: "ja" },
      { title: "Apple Info. (Applech2)", url: "https://applech2.com/feed", lang: "ja" },
    ],
  },
  {
    id: "science",
    title: { en: "Science", de: "Wissenschaft", ja: "科学" },
    description: { en: "Research, space and nature.", de: "Forschung, Weltraum und Natur.", ja: "研究、宇宙、自然。" },
    feeds: [
      { title: "Spektrum der Wissenschaft", url: "https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406", lang: "de" },
      { title: "scinexx", url: "https://www.scinexx.de/feed/", lang: "de" },
      { title: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", lang: "en" },
      { title: "NASA", url: "https://www.nasa.gov/feed/", lang: "en" },
      { title: "Nature", url: "https://www.nature.com/nature.rss", lang: "en" },
      { title: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml", lang: "en" },
      { title: "sorae 宇宙へのポータルサイト", url: "https://sorae.info/feed", lang: "ja" },
      { title: "ナゾロジー", url: "https://nazology.kusuguru.co.jp/feed", lang: "ja" },
      { title: "日経サイエンス", url: "https://www.nikkei-science.com/?feed=rss2", lang: "ja" },
    ],
  },
  {
    id: "design",
    title: { en: "Design", de: "Design", ja: "デザイン" },
    description: { en: "Web design, interfaces and creative work.", de: "Webdesign, Oberflächen und kreative Arbeit.", ja: "ウェブデザイン、UI、クリエイティブ。" },
    feeds: [
      { title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", lang: "en" },
      { title: "A List Apart", url: "https://alistapart.com/main/feed/", lang: "en" },
      { title: "UX Collective", url: "https://uxdesign.cc/feed", lang: "en" },
      { title: "Creative Bloq", url: "https://www.creativebloq.com/feeds/all", lang: "en" },
      { title: "designboom", url: "https://www.designboom.com/feed/", lang: "en" },
      { title: "コリス", url: "https://coliss.com/feed/", lang: "ja" },
      { title: "AXIS", url: "https://www.axismag.jp/feed", lang: "ja" },
      { title: "Web Creator Box", url: "https://www.webcreatorbox.com/feed", lang: "ja" },
    ],
  },
];

/**
 * The feeds of a pack worth showing in a language: its own language first, English after it (except for Japanese). A pack without any feed
 * for that language yields only English ones; a pack with nothing to show gives an empty list.
 */
export function feedsForLanguage<T extends { lang: string }>(pack: { feeds: T[] }, language: string): T[] {
  const base = language.toLowerCase().split("-")[0];
  // A feed without a language (from a host) is always shown.
  const own = pack.feeds.filter((feed) => feed.lang === base || feed.lang === "");
  // English ones follow for most languages; readers of Japanese get them only for a pack that has nothing in Japanese.
  const english = base === "en" || (base === "ja" && own.length > 0) ? [] : pack.feeds.filter((feed) => feed.lang === "en");
  return [...own, ...english];
}
