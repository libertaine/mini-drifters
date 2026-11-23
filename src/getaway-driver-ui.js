// The page side of Getaway Driver (EXPERIMENTAL, v0.8.0 R0 research): its meter, HUD lines, banners
// and results sheet. gymkhana-ui.js hands a Getaway Driver session here and keeps everything else.
// It fills elements index.html already holds; it reads the run and changes nothing in it.
import { cueForGame, cueText } from './getaway-nav.js';

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
  setText($('gym-medal'), 'Research build · no records');
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

const TITLES = { ghost: 'Ghost run', 'low profile': 'Low profile', 'lost them': 'Lost them', busted: 'Busted', 'out of time': 'Out of time' };
function remark(r) {
  if (r.outcome === 'ghost') return 'Nobody looked twice. Never even suspicious.';
  if (r.outcome === 'low profile') return 'Some heads turned, but nobody gave chase.';
  if (r.outcome === 'lost them') return `Spotted ${plural(r.detections, 'time')}, and lost them every time. Then home, quietly.`;
  if (r.outcome === 'busted') return 'Busted. A chasing police car stayed close, and in sight, long enough to fill BUST RISK. Break the line of sight and pull away to drain it.';
  return 'Out of time. The safehouse stopped waiting.';
}

export function showDriverResults(def, game) {
  const run = game.challenge;
  const r = run.result;
  const failed = run.phase === 'failed';
  $('gymkhana-results').dataset.outcome = failed ? 'failed' : 'complete';
  $('gymkhana-results').dataset.layout = def.layout;
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
  setText($('gr-next'), '');
  setText($('gr-best'), 'Research build: no medals, no records. Nothing from this run is saved.');
  setText($('gr-records-note'), '');
}

// The choice sheet: nothing is recorded, so no best, medal or target.
export function showDriverMenu() {
  setText($('challenge-best-label'), 'Research build');
  setText($('challenge-best'), 'No records');
  const handling = $('gymkhana-handling');
  setText(handling, handling.textContent.replace(' Each handling mode keeps its own best.', ''));
}
