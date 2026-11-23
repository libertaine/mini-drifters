// Turns the game's own run events and foreground driving time into a few anonymous counts.
// It only listens: it never writes to the game, its randomness, storage or the page, and
// everything it can send is listed in docs/ANALYTICS.md. Contains no browser code.

// Mini Drifters shares one Umami website with Steeped in Trouble, so every event says
// which game it came from.
export const EVENT_PREFIX = 'md_';

export const EVENTS = Object.freeze({
  gameStart: 'md_game_start',
  runStart: 'md_run_start',
  lap: 'md_lap_milestone',
  runComplete: 'md_run_complete',
});

export const ENGAGEMENT_THRESHOLDS = Object.freeze([
  ['md_engaged_30s', 30_000],
  ['md_engaged_1m', 60_000],
  ['md_engaged_3m', 180_000],
  ['md_engaged_5m', 300_000],
]);

export const CATEGORIES = Object.freeze(['tracks', 'gymkhana', 'getaway']);
export const LAP_NUMBERS = Object.freeze([1, 2, 3]);

// Driving time stops counting after this long with nothing held: someone has walked away.
export const IDLE_MS = 30_000;
// A longer gap between frames means a suspended tab or a sleeping machine. It is discarded.
export const MAX_FRAME_GAP_MS = 1_000;
// Counted runs per page load. Laps and completions only follow a counted run, so this bounds
// everything a page load can send (docs/ANALYTICS.md).
export const MAX_COUNTED_RUNS = 100;

/**
 * The kind of session, as analytics sees it: a scored circuit run, a Gymkhana challenge or a
 * Getaway mission. The driving lesson and the practice pad are not normal play, so null.
 * @param {{ mode: string, layout?: string | null }} session `game.mode` and the challenge's layout.
 */
export function categoryOf({ mode, layout = null }) {
  if (mode === 'normal') return 'tracks';
  if (mode === 'gymkhana') return layout === 'urban' ? 'getaway' : 'gymkhana';
  return null;
}

/**
 * @param {{ send: (name: string, data?: object) => void, now: () => number, foreground: () => boolean }} options
 *   `now` is monotonic milliseconds; `foreground` says the page is visible and focused.
 */
export function createAnalytics({ send, now, foreground }) {
  let gameStarted = false;
  let countedRuns = 0;
  // The run in front of the player. A new runId means the last one was retried or left: it
  // simply stops being watched, and nothing is sent for it.
  let run = { id: null, category: null, started: false, counted: false, laps: new Set(), complete: false };
  let engaged = 0, nextThreshold = 0;
  let lastFrame = now(), lastActivity = lastFrame, wasCounting = false;

  // Analytics may never interrupt the game.
  function emit(name, data) {
    try {
      send(name, data);
    } catch {
      // A broken tracker costs only the count.
    }
  }

  function watch(id, category) {
    if (run.id === id) return;
    run = { id, category, started: false, counted: false, laps: new Set(), complete: false };
    lastActivity = now();
  }

  // A run begins when its clock does: the first press off the grid. Retrying or leaving
  // from the grid has not started anything.
  function begin() {
    run.started = true;
    lastActivity = now();
    if (countedRuns >= MAX_COUNTED_RUNS) return;
    countedRuns += 1;
    run.counted = true;
    if (!gameStarted) {
      gameStarted = true;
      emit(EVENTS.gameStart);
    }
    emit(EVENTS.runStart, { category: run.category });
  }

  /**
   * One of the game's own run events (game.js), as it happens.
   * @param {object} event as onRunEvent gives it.
   * @param {{ lap?: number, category?: string | null }} detail `lap`: valid laps completed so far,
   *   for a lap event. `category`: categoryOf the session, for a start event.
   */
  function runEvent(event, { lap, category = null } = {}) {
    if (!event) return;
    // A new run, or the end of one, takes effect at once, so nothing of the last run can be
    // credited to the next, even within the same frame.
    if (event.type === 'start') {
      watch(event.runId, CATEGORIES.includes(category) ? category : null);
      return;
    }
    if (event.type === 'abandon') {
      run = { ...run, id: null, counted: false };
      return;
    }
    if (event.runId !== run.id || !run.counted || run.complete) return;
    const circuit = run.category === 'tracks';
    if (event.type === 'lap') {
      if (!circuit || event.valid !== true || !LAP_NUMBERS.includes(lap) || run.laps.has(lap)) return;
      run.laps.add(lap);
      emit(EVENTS.lap, { lap });
      return;
    }
    // A circuit run that ends with its laps done, or a challenge or mission completed. A failed
    // challenge, a bust, a retry and a run left for the title send nothing.
    const completed = circuit ? event.type === 'finish' : event.type === 'challenge' && event.completed === true;
    if (!completed) return;
    run.complete = true;
    emit(EVENTS.runComplete, { category: run.category });
  }

  /**
   * Once per animation frame, after the simulation has advanced.
   * @param {{ runId: number, category: string | null, racing: boolean, active: boolean }} view
   *   `racing`: the run's clock is running (not on the grid, not paused, not finished).
   *   `active`: some driving input is held this frame. Only the moment is kept, never which.
   */
  function frame({ runId, category, racing, active }) {
    const time = now();
    const step = time - lastFrame;
    lastFrame = time;
    watch(runId, CATEGORIES.includes(category) ? category : null);
    if (racing && run.category && !run.started) begin();
    if (active) lastActivity = time;
    const counting = racing && !!run.category && time - lastActivity <= IDLE_MS && foreground();
    if (counting && wasCounting && step > 0 && step <= MAX_FRAME_GAP_MS) {
      engaged += step;
      if (nextThreshold < ENGAGEMENT_THRESHOLDS.length && engaged >= ENGAGEMENT_THRESHOLDS[nextThreshold][1]) {
        emit(ENGAGEMENT_THRESHOLDS[nextThreshold][0]);
        nextThreshold += 1;
      }
    }
    wasCounting = counting;
  }

  // Nothing the observer does can reach the game, whatever goes wrong in here.
  const guarded = (fn) => (...args) => {
    try {
      fn(...args);
    } catch {
      // Ignored: the game carries on.
    }
  };

  return {
    frame: guarded(frame),
    runEvent: guarded(runEvent),
    get engagedMs() { return engaged; },
    get countedRuns() { return countedRuns; },
  };
}
