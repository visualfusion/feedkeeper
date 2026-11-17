/**
 * Blocks that recommend other articles, named by the markup of well-known plugins and sites. They are never part of
 * the story. Add a selector only when a plugin or theme is widespread or a site's block is specific enough that it
 * cannot hit an article; a fixture in `test/fixtures/content/sidebars` shows the expected result.
 */
export const SIDEBAR_SELECTORS: readonly string[] = [
  // WordPress plugins and themes for related and popular posts.
  ".yarpp-related", "#jp-relatedposts", ".jp-relatedposts", ".related-posts", ".related_posts", ".relatedposts",
  ".wp-block-latest-posts", ".post-navigation", ".crp_related",
  // Sites that mark the block with an analytics label.
  "[data-track='popular-stories']", "[data-track='related-stories']", "[data-track='related-articles']", "[data-track*='ranking' i]",
  // Broadcasters' "this topic in our programme" teasers.
  ".relatedbroadcast",
];
