import { BUILT_IN_FEED_LISTS, type FeedListData, type Localized } from "./feedListsData.js";

export interface FeedListFeed {
  title: string;
  url: string;
  /** Language of the feed's content (`de`, `en`, `ja`, …). */
  lang: string;
  description: string;
}

export interface FeedList {
  id: string;
  iconSymbol: string;
  title: string;
  description: string;
  feeds: FeedListFeed[];
}

/** Where the lists come from. A host that embeds the server can replace the built-in ones. */
export interface FeedListsProvider {
  getFeedLists(): FeedListData[];
}

class BuiltInFeedListsProvider implements FeedListsProvider {
  getFeedLists(): FeedListData[] {
    return BUILT_IN_FEED_LISTS;
  }
}

let activeProvider: FeedListsProvider = new BuiltInFeedListsProvider();

export function setFeedListsProvider(provider: FeedListsProvider): void {
  activeProvider = provider;
}

const SUPPORTED_LANGUAGES = ["en", "de", "ja", "ru"] as const;

/** The language to answer in: the first supported one in `?lang=` or `Accept-Language`, English otherwise. */
export function pickFeedListLanguage(requested: string | undefined): (typeof SUPPORTED_LANGUAGES)[number] {
  for (const part of (requested ?? "").split(",")) {
    const code = part.split(";")[0]!.trim().toLowerCase().split("-")[0];
    const found = SUPPORTED_LANGUAGES.find((language) => language === code);
    if (found) return found;
  }
  return "en";
}

function text(value: Localized, language: keyof Localized): string {
  return value[language] || value.en;
}

/** The lists with their texts in one language. Lists without a feed are left out. */
export function resolveFeedLists(language: keyof Localized): FeedList[] {
  return activeProvider.getFeedLists()
    .filter((list) => list.feeds.length > 0)
    .map((list) => ({
      id: list.id,
      iconSymbol: list.iconSymbol,
      title: text(list.title, language),
      description: text(list.description, language),
      feeds: list.feeds.map((feed) => ({
        title: feed.title,
        url: feed.url,
        lang: feed.lang,
        description: text(feed.description, language),
      })),
    }));
}
