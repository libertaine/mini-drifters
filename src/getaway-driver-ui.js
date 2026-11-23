// The page side of Getaway Driver: its meter, HUD lines, banners, results sheet and completion
// counts. gymkhana-ui.js hands a Getaway Driver session here and keeps everything else. It fills
// elements index.html already holds; it reads the run and the counts and changes neither.
import { cueForGame, cueText } from './getaway-nav.js';
import { DRIVER_OUTCOMES, driverOutcome } from './getaway-driver.js';

const $ = (id) => document.getElementById(id);
const MPH_PER_MS = 2.23694;
const mph = (ms) => `${Math.round(ms * MPH_PER_MS)} mph`;
const secs = (s) => `${s.toFixed(1)} s`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

export const isDriver = (def) => def?.mission === 'driver';

// ATTENTION's tiers, from the run and the mission's numbers.
export function attentionTier(def, run) {
  const D = def.driverTuning;
  if (run.pursuing) return 'pursuit';
  if (run.reported) return 'reported';
  if (run.attention >= D.detectAt) return 'hot';
  if (run.attention >= D.suspectAt) return 'suspicious';
  return 'unnoticed';
}
const TIER_WORDS = { unnoticed: 'Unnoticed', suspicious: 'Suspicious', hot: 'Hot', reported: 'Reported', pursuit: 'Pursuit' };
const TIER_LEVEL = { unnoticed: 'clear', suspicious: 'close', hot: 'critical', reported: 'critical' };
const PURSUIT_WORDS = { clear: 'Pursuit', close: 'Pursuit', critical: 'Critical', busted: 'Busted' };

function why(run) {
  const h = run.heat;
  const parts = [];
  if (h.speeding) parts.push('Speeding');
  if (h.drifting) parts.push('Drifting');
  if (h.hit) parts.push('Crash');
  if (h.smash) parts.push('Smash');
  if (run.seen) parts.push(parts.length ? 'police watching ×4' : h.scrutiny ? 'Police watching closely' : 'Police can see you');
  if (parts.length) return parts.join(' · ');
  return run.attention > 0 ? 'Calm · cooling down' : 'Calm';
}

// The meter: ATTENTION until a chase starts; then BUST RISK, with the escape under it.
let lastValue = 0;
export function updateDriverMeter(def, run, game) {
  const el = $('bust');
  if (!el) return;
  const on = game.state !== 'menu';
  el.hidden = !on;
  if (!on) { document.body.dataset.bust = ''; return; }
  const D = def.driverTuning;
  const busted = run.phase === 'failed' && run.reason === 'busted';
  const pursuit = run.pursuing || busted;
  el.dataset.mode = pursuit ? 'pursuit' : 'attention';
  const tier = attentionTier(def, run);
  const level = busted ? 'busted' : pursuit ? run.level : run.phase !== 'running' ? 'clear' : TIER_LEVEL[tier];
  el.dataset.level = level;
  document.body.dataset.bust = pursuit ? level : '';
  const value = pursuit ? run.meter : run.attention;
  const pct = Math.round(value * 100);
  el.style.setProperty('--bust', `${pct}%`);
  el.style.setProperty('--mark', pursuit ? '60%' : `${Math.round(D.detectAt * 100)}%`);
  const trend = value > lastValue + 1e-6 ? 'rising' : value < lastValue - 1e-6 ? 'falling' : 'steady';
  lastValue = value;
  el.dataset.trend = trend;
  setText(el.querySelector('.bust-label'), pursuit ? 'Bust risk' : 'Attention');
  setText($('bust-state'), busted ? 'Busted' : pursuit ? PURSUIT_WORDS[run.level] : TIER_WORDS[tier]);
  setText($('bust-pct'), `${pct}%`);
  let detail;
  if (busted) detail = 'They stayed close too long';
  else if (pursuit) {
    const gap = Number.isFinite(run.gap) ? `Police ${Math.round(run.gap)} m` : 'Police';
    detail = `${gap} · ${run.seen ? 'they can see you' : run.gap < D.loseGap ? 'out of sight, still close' : 'out of sight · keep going'}`;
  } else if (tier === 'reported') detail = 'Reported · a patrol car is on its way';
  else detail = why(run);
  setText($('bust-detail'), detail);
  const lose = $('bust-lose');
  if (lose) {
    lose.hidden = !run.pursuing;
    lose.style.setProperty('--lose', `${Math.round(run.lose * 100)}%`);
    setText($('bust-lose-pct'), `${Math.round(run.lose * 100)}%`);
  }
}

// The navigation chip's words: the safehouse, or losing the police first.
export function driverNavText(run, cue) {
  const words = cueText({ exitOpen: true, nextCamera: 0, missed: [] }, cue, []);
  const goal = run.pursuing ? 'LOSE THEM FIRST' : 'SAFEHOUSE';
  const call = words.call === 'GATE AHEAD' ? 'SAFEHOUSE AHEAD' : words.call;
  return { ...words, call, goal };
}

export function driverNavGoal(run) {
  return run.pursuing ? 'missed' : 'escape';
}

export function driverCue(game) {
  return cueForGame(game);
}

// The HUD panel's lines.
export function updateDriverHud(def, run) {
  const chasing = run.police.filter((u) => u.mode === 'pursue').length;
  const sent = run.police.filter((u) => u.mode === 'respond').length;
  const searching = run.police.filter((u) => u.mode === 'search').length;
  const patrol = run.police.length - chasing - sent - searching;
  const police = [chasing && `${chasing} chasing`, sent && `${sent} responding`, searching && `${searching} searching`, patrol && `${patrol} on patrol`]
    .filter(Boolean).join(' · ');
  setText($('gym-gates'), `Police: ${police} · safehouse ${run.pursuing ? 'shut' : 'open'}`);
  const left = def.timeLimit - run.time;
  setText($('gym-cones'), run.phase === 'running' && left <= 30 ? `${Math.ceil(left)} s left` : '');
  setText($('gym-best'), `Spotted ${run.detections}× · lost them ${run.escapes}× · top ${mph(run.topSpeed)}`);
  // The way home this run is still on for (the results sheet's classification, applied now).
  setText($('gym-medal'), run.phase !== 'running' ? '' : run.pursuing ? 'Lose them first'
    : `On for: ${OUTCOME_NAME[driverOutcome(run, def.driverTuning)]}`);
}

export function driverBanner(event) {
  switch (event.type) {
    case 'suspicious': return { kind: 'lap', text: 'SUSPICIOUS · EASE OFF' };
    case 'reported': return { kind: 'lost', text: 'REPORTED · A PATROL CAR IS COMING' };
    case 'spotted': return { kind: 'lost', text: `SPOTTED · PURSUIT!` };
    case 'joined': return { kind: 'lost', text: 'ANOTHER CAR JOINS THE CHASE' };
    case 'lost': return { kind: 'banked', text: 'LOST THEM · LIE LOW' };
    case 'locked': return { kind: 'penalty', text: 'SAFEHOUSE SHUT · LOSE THEM FIRST' };
    case 'smash': {
      const what = event.kind === 'fruit' ? 'FRUIT STAND' : 'BARRICADE';
      return event.by === 'police' ? { kind: 'lap', text: `THE COP TOOK OUT THE ${what}` } : { kind: 'penalty', text: `${what}! · THAT GOT NOTICED` };
    }
    default: return null;
  }
}

const OUTCOME_NAME = Object.fromEntries(DRIVER_OUTCOMES.map((o) => [o.outcome, o.name]));
const TITLES = { ...OUTCOME_NAME, busted: 'Busted', 'out of time': 'Out of time' };
// After a finish: how the other ways home differ (the next one up, as a medal's "Next:" line does).
const NEXT = {
  ghost: 'The cleanest way home: never even suspicious.',
  'low profile': 'Next time, stay under SUSPICIOUS all the way for a Ghost run.',
  'lost them': 'Next time, avoid the chase for Low profile, or stay under SUSPICIOUS for a Ghost run.',
};

// "Ghost run 2 · Low profile 0 · Lost them 1" for one environment and mode.
export function countsLine(counts) {
  return DRIVER_OUTCOMES.map((o) => `${o.name} ${counts[o.id]}`).join(' · ');
}
const total = (counts) => DRIVER_OUTCOMES.reduce((n, o) => n + counts[o.id], 0);

// The sheet's and the results' storage line.
export function driverNote(records) {
  if (!records.available) return 'Storage unavailable. Finishes cannot be counted on this device.';
  if (records.readOnly) return 'Getaway Driver counts were saved by a newer version of Mini Drifters. They are kept, but cannot be updated here.';
  return '';
}
function remark(r) {
  if (r.outcome === 'ghost') return 'Nobody looked twice. Never even suspicious.';
  if (r.outcome === 'low profile') return 'Some heads turned, but nobody gave chase.';
  if (r.outcome === 'lost them') return `Spotted ${plural(r.detections, 'time')}, and lost them every time. Then home, quietly.`;
  if (r.outcome === 'busted') return 'Busted. A chasing police car stayed close, and in sight, long enough to fill BUST RISK. Break the line of sight and pull away to drain it.';
  return 'Out of time. The safehouse stopped waiting.';
}

export function showDriverResults(def, game, records) {
  const run = game.challenge;
  const r = run.result;
  const failed = run.phase === 'failed';
  $('gymkhana-results').dataset.outcome = failed ? 'failed' : 'complete';
  $('gymkhana-results').dataset.layout = def.layout;
  // Which way home, for the title's colour: 'ghost' | 'low-profile' | 'lost-them', '' after a failure.
  $('gymkhana-results').dataset.driver = failed ? '' : DRIVER_OUTCOMES.find((o) => o.outcome === r.outcome)?.id ?? '';
  setText($('gr-eyebrow'), `${def.name} · ${game.handling.name} handling`);
  setText($('gr-title'), TITLES[r.outcome] ?? 'Run over');
  setText($('gr-reason'), remark(r));
  setText($('gr-label'), 'Time');
  setText($('gr-value'), failed ? '--' : secs(r.time));
  $('gr-new').hidden = true;
  const rows = [
    ['Peak attention', `${Math.round(r.peakAttention * 100)}%${r.reports ? ` · reported ${plural(r.reports, 'time')}` : ''}`],
    ['Spotted', r.detections ? plural(r.detections, 'time') : 'Never'],
    ['Lost them', r.detections ? `${r.escapes} of ${r.detections}` : '--'],
    ['Time chased', r.detections ? secs(r.pursuitTime) : '--'],
    ['Closest pursuer', r.minGap === null ? '--' : `${r.minGap.toFixed(1)} m`],
    ['Bust risk peak', `${Math.round(r.peakMeter * 100)}%`],
    ['Seen by police', secs(r.seenTime)],
    ['Speeding', secs(r.speedingTime)],
    ['Drifting', secs(r.driftingTime)],
    ['Crashes · smashes', `${r.wallHits} · ${r.smashes}`],
    ['Drift score (not kept)', String(Math.round(r.score))],
    ['Top speed', mph(r.topSpeed)],
    ...(failed ? [['Time', secs(r.time)]] : []),
  ];
  const stats = $('gr-stats');
  while (stats.children.length > 1) stats.lastElementChild.remove();
  for (const [name, value] of rows) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = name;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.append(dt, dd);
    stats.append(row);
  }
  const medal = $('gr-medal');
  medal.hidden = true;
  medal.dataset.new = 'false';
  setText($('gr-next'), failed ? '' : NEXT[r.outcome] ?? '');
  const counts = records.countsFor(def.id, game.handling.id);
  const counted = !failed && records.counted;
  setText($('gr-best'), `Finishes with ${game.handling.name} handling: ${countsLine(counts)}${counted ? ` (+1 ${OUTCOME_NAME[r.outcome]})` : ''}`);
  setText($('gr-records-note'), driverNote(records));
}

// The choice sheet: no best, medal or target, but how often this device has finished each way.
export function showDriverMenu(def, handling, device, records) {
  const counts = records.countsFor(def.id, handling.id);
  setText($('challenge-best-label'), 'Finishes');
  setText($('challenge-best'), String(total(counts)));
  setText($('challenge-next'), countsLine(counts));
  setText($('gymkhana-handling'), device === 'controller'
    ? `${handling.name} handling, chosen on the title screen. Each handling mode keeps its own count.`
    : `${handling.name} handling. Press H to change it. Each handling mode keeps its own count.`);
}
