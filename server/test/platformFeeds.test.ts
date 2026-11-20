import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applePodcastId,
  fediverseFeedCandidate,
  feedUrlFromAppleLookup,
  platformFeedCandidates,
  youtubeChannelFeedFromHtml,
} from "../src/feeds/platformFeeds.js";

const candidates = (address: string) => platformFeedCandidates(new URL(address));

test("platform pages lead to their feed address", () => {
  assert.deepEqual(candidates("https://www.reddit.com/r/apple"), ["https://www.reddit.com/r/apple/.rss"]);
  assert.deepEqual(candidates("https://old.reddit.com/r/swift/top/?t=week"), ["https://www.reddit.com/r/swift/.rss"]);
  assert.deepEqual(candidates("https://reddit.com/user/spez"), ["https://www.reddit.com/user/spez/.rss"]);
  assert.deepEqual(candidates("https://reddit.com/"), []);

  assert.deepEqual(candidates("https://medium.com/@kentcdodds"), ["https://medium.com/feed/@kentcdodds"]);
  assert.deepEqual(candidates("https://medium.com/swlh/some-article-1234"), ["https://medium.com/feed/swlh"]);
  assert.deepEqual(candidates("https://medium.com/tag/swift"), []);
  assert.deepEqual(candidates("https://medium.com/"), []);

  assert.deepEqual(candidates("https://www.youtube.com/playlist?list=PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-"), ["https://www.youtube.com/feeds/videos.xml?playlist_id=PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-"]);
  assert.deepEqual(candidates("https://www.youtube.com/playlist?list=x<script>"), []);
  assert.deepEqual(candidates("https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"), ["https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"]);
  assert.deepEqual(candidates("https://www.youtube.com/channel/invalid"), []);

  assert.deepEqual(candidates("https://bsky.app/profile/bsky.app"), ["https://bsky.app/profile/bsky.app/rss"]);
  assert.deepEqual(candidates("https://bsky.app/profile/did:plc:z72i7hdynmk6r22z27h6tvur/post/3k"), ["https://bsky.app/profile/did:plc:z72i7hdynmk6r22z27h6tvur/rss"]);
  assert.deepEqual(candidates("https://bsky.app/"), []);

  assert.deepEqual(candidates("https://github.com/visualfusion/feedkeeper"), ["https://github.com/visualfusion/feedkeeper/releases.atom"]);
  assert.deepEqual(candidates("https://github.com/visualfusion/feedkeeper/commits/main"), ["https://github.com/visualfusion/feedkeeper/commits.atom"]);
  assert.deepEqual(candidates("https://github.com/visualfusion"), ["https://github.com/visualfusion.atom"]);
  assert.deepEqual(candidates("https://github.com/explore"), []);

  assert.deepEqual(candidates("https://substack.com/@platformer"), ["https://platformer.substack.com/feed"]);
  assert.deepEqual(candidates("https://platformer.substack.com/p/some-post"), ["https://platformer.substack.com/feed"]);
  assert.deepEqual(candidates("https://substack.com/"), []);

  assert.deepEqual(candidates("https://codeberg.org/forgejo/forgejo"), ["https://codeberg.org/forgejo/forgejo/releases.rss"]);

  assert.deepEqual(candidates("https://example.org/r/apple"), []);
});

test("fediverse and YouTube handle helpers extract feed candidates", () => {
  assert.equal(fediverseFeedCandidate(new URL("https://mastodon.social/@gargron")), "https://mastodon.social/@gargron.rss");
  assert.equal(fediverseFeedCandidate(new URL("https://chaos.social/@user/123456")), "https://chaos.social/@user.rss");
  assert.equal(fediverseFeedCandidate(new URL("https://medium.com/@kentcdodds")), null);
  assert.equal(fediverseFeedCandidate(new URL("https://www.youtube.com/@mkbhd")), null);

  assert.equal(
    youtubeChannelFeedFromHtml('<html><script>var x={"channelId":"UCBJycsmduvYEL83R_U4JriQ"};</script></html>', new URL("https://www.youtube.com/@mkbhd")),
    "https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ",
  );
  assert.equal(
    youtubeChannelFeedFromHtml('<html><script>var x={"channelId":"UCBJycsmduvYEL83R_U4JriQ"};</script></html>', new URL("https://example.org/@mkbhd")),
    null,
  );
});

test("an Apple Podcasts address gives the show's id and the lookup answer its feed", () => {
  assert.equal(applePodcastId(new URL("https://podcasts.apple.com/de/podcast/lage-der-nation/id1204393114")), "1204393114");
  assert.equal(applePodcastId(new URL("https://podcasts.apple.com/us/podcast/x/id1204393114?i=1000")), "1204393114");
  assert.equal(applePodcastId(new URL("https://example.org/podcast/id1204393114")), null);
  assert.equal(feedUrlFromAppleLookup('{"results":[{"kind":"podcast","feedUrl":"https://example.org/feed.xml"}]}'), "https://example.org/feed.xml");
  assert.equal(feedUrlFromAppleLookup('{"results":[]}'), null);
  assert.equal(feedUrlFromAppleLookup("not json"), null);
});
