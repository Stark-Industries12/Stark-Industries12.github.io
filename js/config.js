/*
 * Front-end config used when the site runs as a static demo (GitHub Pages),
 * where there is no server to ask.
 *
 * A PostHog project key is a publishable, write-only key - it is designed to
 * sit in client-side code and cannot read any data back out. When the Node
 * server is running it overrides this with POSTHOG_API_KEY from the
 * environment, so local runs need no edit here.
 */
window.ABC_CONFIG = {
  posthogKey: 'phc_A8ZkmaWBqgT5DMzMvjow8pK3XN58oakyDvDqKMD9LbP2',
  posthogHost: 'https://us.i.posthog.com'
};
