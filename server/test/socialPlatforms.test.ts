import assert from "node:assert/strict";
import { test } from "node:test";
import { socialPost } from "../src/feeds/content/embeds/social.js";
import { embedTarget } from "../src/feeds/content/embeds/video.js";

const cases = [
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "YouTube", "video", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["https://youtube.com/watch?v=dQw4w9WgXcQ", "YouTube", "video", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
  ["https://youtu.be/dQw4w9WgXcQ", "YouTube", "video", "https://youtu.be/dQw4w9WgXcQ"],
  ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "YouTube", "video", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
  ["https://vimeo.com/123456789", "Vimeo", "video", "https://vimeo.com/123456789"],
  ["https://www.dailymotion.com/video/x8abcde", "Dailymotion", "video", "https://www.dailymotion.com/video/x8abcde"],
  ["https://www.flickr.com/photos/example/12345678901", "Flickr", "social", "https://www.flickr.com/photos/example/12345678901"],
  ["https://flic.kr/p/AbCdEf", "Flickr", "social", "https://flic.kr/p/AbCdEf"],
  ["https://www.instagram.com/p/ABC123/", "Instagram", "social", "https://www.instagram.com/p/ABC123/"],
  ["https://m.instagram.com/reel/ABC123/", "Instagram", "social", "https://m.instagram.com/reel/ABC123/"],
  ["https://x.com/example/status/123456789", "X", "social", "https://x.com/example/status/123456789"],
  ["https://x.com/i/status/123456789", "X", "social", "https://x.com/i/status/123456789"],
  ["https://twitter.com/example/status/123456789", "X", "social", "https://twitter.com/example/status/123456789"],
  ["https://mobile.twitter.com/example/status/123456789", "X", "social", "https://mobile.twitter.com/example/status/123456789"],
  ["https://www.tiktok.com/@example/video/123456789", "TikTok", "social", "https://www.tiktok.com/@example/video/123456789"],
  ["https://bsky.app/profile/example.com/post/abc123", "Bluesky", "social", "https://bsky.app/profile/example.com/post/abc123"],
  ["https://www.reddit.com/r/example/comments/abc123/title/", "Reddit", "social", "https://www.reddit.com/r/example/comments/abc123/title/"],
  ["https://www.facebook.com/example/posts/123456789", "Facebook", "social", "https://www.facebook.com/example/posts/123456789"],
  ["https://m.facebook.com/example/posts/123456789", "Facebook", "social", "https://m.facebook.com/example/posts/123456789"],
  ["https://open.spotify.com/track/1234567890123456789012?si=abc", "Spotify", "audio", "https://open.spotify.com/track/1234567890123456789012"],
  ["https://open.spotify.com/playlist/1234567890123456789012?si=abc", "Spotify", "audio", "https://open.spotify.com/playlist/1234567890123456789012"],
  ["https://soundcloud.com/artist/track", "SoundCloud", "audio", "https://soundcloud.com/artist/track"],
  ["https://www.threads.net/@example/post/abc123?xmt=123", "Threads", "social", "https://www.threads.net/@example/post/abc123"],
] as const;

for (const [url, name, kind, expectedUrl] of cases) {
  test(`recognizes ${name} item URL: ${url}`, () => {
    const result = socialPost(url);
    assert.ok(result);
    assert.equal(result.platform.name, name);
    assert.equal(result.platform.kind, kind);
    assert.equal(result.url, expectedUrl);
  });
}

for (const url of [
  "https://www.youtube.com/",
  "https://www.youtube.com/@example",
  "https://www.youtube.com/watch",
  "https://www.youtube.com/playlist",
  "https://vimeo.com/channels/staffpicks",
  "https://www.flickr.com/photos/example/",
  "https://www.instagram.com/example/",
  "https://open.spotify.com/user/example",
  "https://soundcloud.com/artist",
  "https://example.com/post/123",
  "javascript:alert(1)",
]) {
  test(`rejects non-item URL: ${url}`, () => {
    assert.equal(socialPost(url), null);
  });
}

test("normalizes YouTube iframe targets including youtu.be", () => {
  assert.deepEqual(embedTarget("https://www.youtube.com/embed/dQw4w9WgXcQ"), {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    name: "YouTube",
  });
  assert.deepEqual(embedTarget("https://youtu.be/dQw4w9WgXcQ"), {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    name: "YouTube",
  });
});

test("normalizes Vimeo and Dailymotion iframe targets", () => {
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
