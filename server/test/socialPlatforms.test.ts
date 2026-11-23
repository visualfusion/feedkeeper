import assert from "node:assert/strict";
import { test } from "node:test";
import { socialPost } from "../src/feeds/content/embeds/social.js";
import { embedTarget } from "../src/feeds/content/embeds/video.js";

const cases = [
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "YouTube", "social"],
  ["https://youtu.be/dQw4w9WgXcQ", "YouTube", "social"],
  ["https://vimeo.com/123456789", "Vimeo", "social"],
  ["https://www.dailymotion.com/video/x8abcde", "Dailymotion", "social"],
  ["https://www.flickr.com/photos/example/12345678901", "Flickr", "social"],
  ["https://flic.kr/p/AbCdEf", "Flickr", "social"],
  ["https://imgur.com/a1B2c3D", "Imgur", "social"],
  ["https://www.mixcloud.com/dj/example-mix/", "Mixcloud", "audio"],
  ["https://www.ted.com/talks/example_talk", "TED", "social"],
  ["https://example.tumblr.com/post/123456789012/example", "Tumblr", "social"],
  ["https://www.kickstarter.com/projects/creator/project-name", "Kickstarter", "social"],
  ["https://www.videopress.com/v/abc123", "VideoPress", "social"],
  ["https://speakerdeck.com/example/presentation", "Speaker Deck", "social"],
  ["https://pca.st/episode/abc123", "Pocket Casts", "audio"],
  ["https://www.canva.com/design/DAF123/view", "Canva", "social"],
  ["https://www.pinterest.com/pin/123456789012345678", "Pinterest", "social"],
  ["https://giphy.com/gifs/funny-cat-abc123", "GIPHY", "social"],
  ["https://audioboom.com/posts/1234567", "Audioboom", "audio"],
  ["https://audius.co/example/track", "Audius", "audio"],
  ["https://open.spotify.com/track/1234567890123456789012", "Spotify", "audio"],
  ["https://soundcloud.com/artist/track", "SoundCloud", "audio"],
  ["https://www.instagram.com/p/ABC123/", "Instagram", "social"],
  ["https://x.com/example/status/123456789", "X", "social"],
  ["https://www.tiktok.com/@example/video/123456789", "TikTok", "social"],
  ["https://bsky.app/profile/example.com/post/abc123", "Bluesky", "social"],
  ["https://www.reddit.com/r/example/comments/abc123/title/", "Reddit", "social"],
  ["https://www.facebook.com/example/posts/123456789", "Facebook", "social"],
  ["https://www.threads.net/@example/post/abc123", "Threads", "social"],
] as const;

for (const [url, name, kind] of cases) {
  test(`recognizes ${name} single-item URLs`, () => {
    const result = socialPost(url);
    assert.ok(result);
    assert.equal(result.platform.name, name);
    assert.equal(result.platform.kind, kind);
  });
}

for (const url of [
  "https://www.youtube.com/",
  "https://www.youtube.com/@example",
  "https://www.youtube.com/playlist?list=PL123456",
  "https://vimeo.com/channels/staffpicks",
  "https://www.flickr.com/photos/example/",
  "https://imgur.com/a/album123",
  "https://open.spotify.com/playlist/1234567890123456789012",
  "https://www.pinterest.com/example/",
  "https://example.com/post/123",
  "javascript:alert(1)",
]) {
  test(`does not turn non-item URL into a card: ${url}`, () => {
    assert.equal(socialPost(url), null);
  });
}

test("video iframe targets use the versioned provider patterns", () => {
  assert.deepEqual(embedTarget("https://www.youtube.com/embed/dQw4w9WgXcQ"), {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    name: "YouTube",
  });
  assert.deepEqual(embedTarget("https://player.vimeo.com/video/123456789"), {
    url: "https://vimeo.com/123456789",
    name: "Vimeo",
  });
  assert.deepEqual(embedTarget("https://www.dailymotion.com/embed/video/x8abcde"), {
    url: "https://www.dailymotion.com/video/x8abcde",
    name: "Dailymotion",
  });
  assert.equal(embedTarget("https://player.vimeo.com/video/not-a-number"), null);
});
