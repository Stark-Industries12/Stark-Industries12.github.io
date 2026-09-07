/*
 * PostHog wiring for ABC Tutoring.
 *
 * The key is served by /api/config so it is set in one place (the
 * POSTHOG_API_KEY env var) instead of being pasted into every page.
 * Events fired before PostHog finishes loading are queued, so page code can
 * call Analytics.track() at any time without worrying about ordering.
 */
window.Analytics = (function () {
  const queue = [];
  let ready = false;

  function loadPostHog(key, host) {
    // Standard PostHog web snippet.
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

    posthog.init(key, {
      api_host: host,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true
    });
  }

  function flush() {
    ready = true;
    while (queue.length) {
      const [event, props] = queue.shift();
      window.posthog.capture(event, props);
    }
  }

  // API.ready resolves with the key from the server when it is running, and
  // from js/config.js when the site is served statically.
  API.ready
    .then((cfg) => {
      if (!cfg.posthogKey) {
        console.info('[analytics] No PostHog key configured - events logged to console only.');
        queue.splice(0).forEach(([e, p]) => console.info('[analytics]', e, p));
        return;
      }
      loadPostHog(cfg.posthogKey, cfg.posthogHost);
      window.posthog.register({ site_mode: cfg.mode });
      flush();
    })
    .catch((err) => console.warn('[analytics] config load failed:', err.message));

  return {
    track(event, props) {
      const enriched = Object.assign({ page: location.pathname }, props || {});
      if (ready && window.posthog) window.posthog.capture(event, enriched);
      else queue.push([event, enriched]);
      if (!ready) console.debug('[analytics] queued', event, enriched);
    },

    // Called once a parent gives us their email, so Dana can see the full
    // journey (first visit -> tutors browsed -> booking) for one family.
    identify(email, props) {
      if (window.posthog && window.posthog.identify) {
        window.posthog.identify(email, props);
      }
    },

    distinctId() {
      try {
        return window.posthog && window.posthog.get_distinct_id ? window.posthog.get_distinct_id() : null;
      } catch (err) {
        return null;
      }
    }
  };
})();
