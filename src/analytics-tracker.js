// Decides whether this page may be counted, and loads the Umami tracker once if so.
// See docs/ANALYTICS.md. Removing this file, src/analytics.js and their calls in main.js
// removes analytics. This is the only file in the game that names another site.
import { createAnalytics } from './analytics.js';

// One Umami website for both of the owner's games: the page path tells their visits apart,
// and the md_ prefix their events. Public configuration, not a credential.
export const WEBSITE_ID = '6f121a0f-990e-4457-8269-6f4833c81820';
export const TRACKER_SRC = 'https://cloud.umami.is/script.js';
const HOSTNAME = 'libertaine.github.io';
const PATHS = new Set(['/mini-drifters/', '/mini-drifters/index.html']);

// The game has no build step: the files GitHub Pages serves are the files in the repository.
// So "production" is where the page is, not a build flag: the published HTTPS address, exactly.
// Local play (server.mjs on 127.0.0.1), the browser checks, previews on any other host and
// file:// copies all fail this test.

// Every URL parameter that turns on a debug, replay, research or test scenario. A unit test
// fails if the game starts reading a parameter that is not sorted into this list or PREFERENCES.
export const SCENARIO_PARAMS = Object.freeze(['debug', 'driver', 'replay', 'research', 'seed', 'scenario', 'test', 'lab']);
// Parameters a player may use without leaving the counts. Only the opt-out exists so far.
export const PREFERENCES = Object.freeze(['analytics']);

function doNotTrack({ navigator: nav, doNotTrack: fromWindow }) {
  const signal = fromWindow || nav.doNotTrack || nav.msDoNotTrack;
  return signal === 1 || signal === '1' || signal === 'yes';
}

export function analyticsAllowed(win) {
  const { protocol, hostname, pathname, search } = win.location;
  if (protocol !== 'https:' || hostname !== HOSTNAME || !PATHS.has(pathname)) return false;
  const params = new URLSearchParams(search);
  if (params.get('analytics')?.trim().toLowerCase() === 'off') return false;
  if (SCENARIO_PARAMS.some((name) => params.has(name))) return false;
  if (win.navigator.webdriver) return false; // an automated browser is never a visitor
  return !doNotTrack(win);
}

/**
 * Add the tracker to the page: one element, no retries. Its automatic pageview is the only
 * visit count. Events raised before it arrives wait for it (only a handful can) and are
 * dropped if it fails to load.
 */
export function loadTracker(win) {
  const script = win.document.createElement('script');
  const pending = [];
  let failed = false;
  const deliver = (name, data) => {
    try {
      win.umami.track(name, data)?.catch?.(() => {});
    } catch {
      // The tracker's trouble stays the tracker's.
    }
  };
  script.addEventListener('load', () => {
    if (typeof win.umami?.track !== 'function') failed = true;
    else for (const [name, data] of pending) deliver(name, data);
    pending.length = 0;
  });
  script.addEventListener('error', () => {
    failed = true;
    pending.length = 0;
  });
  script.async = true;
  script.defer = true;
  script.src = TRACKER_SRC;
  for (const [name, value] of [['website-id', WEBSITE_ID], ['domains', HOSTNAME], ['exclude-search', 'true'],
    ['exclude-hash', 'true'], ['do-not-track', 'true']]) script.setAttribute(`data-${name}`, value);
  win.document.head.append(script);
  return {
    send(name, data) {
      if (failed) return;
      if (typeof win.umami?.track === 'function') deliver(name, data);
      else if (pending.length < 16) pending.push([name, data]);
    },
  };
}

/** The game's single entry point. Returns null, and does nothing at all, on any untracked page. */
export function startAnalytics(win) {
  try {
    if (!analyticsAllowed(win)) return null;
    const { send } = loadTracker(win);
    return createAnalytics({ send, now: () => win.performance.now(),
      foreground: () => win.document.visibilityState === 'visible' && win.document.hasFocus() });
  } catch {
    return null;
  }
}
