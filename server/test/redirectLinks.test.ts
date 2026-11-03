import assert from "node:assert/strict";
import { test } from "node:test";
import { unwrapRedirectLink } from "../src/feeds/redirectLinks.js";

test("a Google redirect link points to the article inside it", () => {
  assert.equal(
    unwrapRedirectLink("https://www.google.com/url?rct=j&sa=t&url=https://feedkeeper.cloud/feedkeeper-vs-feedly&ct=ga&cd=CAIyGTI5&usg=AOvVaw3y"),
    "https://feedkeeper.cloud/feedkeeper-vs-feedly",
  );
  assert.equal(unwrapRedirectLink("https://www.google.de/url?q=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&sa=U"), "https://example.com/a?b=1");
  assert.equal(unwrapRedirectLink("https://google.co.uk/url?url=https://example.org/x"), "https://example.org/x");
});

test("other links are left alone", () => {
  assert.equal(unwrapRedirectLink("https://example.com/article"), "https://example.com/article");
  assert.equal(unwrapRedirectLink("https://www.google.com/search?q=feedkeeper"), "https://www.google.com/search?q=feedkeeper");
  assert.equal(unwrapRedirectLink("https://www.google.com/url?url=javascript:alert(1)"), "https://www.google.com/url?url=javascript:alert(1)");
  assert.equal(unwrapRedirectLink("https://www.google.com/url?sa=t"), "https://www.google.com/url?sa=t");
  assert.equal(unwrapRedirectLink("https://notgoogle.com/url?url=https://example.com"), "https://notgoogle.com/url?url=https://example.com");
  assert.equal(unwrapRedirectLink("not a url"), "not a url");
  assert.equal(unwrapRedirectLink(null), null);
});
