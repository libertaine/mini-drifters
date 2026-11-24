// Circuit Tour (v0.9.0 R2 research build): the Tour's sheets and HUD panel. It only draws:
// what a Tour is worth is tour.js, what is saved is tour-store.js, and main.js decides when.
import {
  TOUR_FORMATS, TOUR_LENGTHS, TOUR_FIELDS, RIVALS, PLAYER_ID, SERIES_POINTS, TARGET_MARKS, JOKER_MULTIPLIER,
  standing, standings, roundTable, tourOutcome, tourPoints, titleOpen, scoringComparison, targetsMaximum, roundStakes,
  roundMultiplier, jokerAllowed,
} from './tour.js';
import { bestsKey } from './tour-store.js';

const RIVAL = Object.fromEntries(RIVALS.map((r) => [r.id, r]));
const MEDAL_NAME = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const ordinal = (n) => `P${n}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createTourUi({ $, trackName, trackMeta, formatNumber, onChoice }) {
  const setText = (id, text) => { const el = $(id); if (el.textContent !== text) el.textContent = text; };

  // --- The Tour sheet's three choices, built once like the title's handling modes. -----------
  const groups = {
    length: { el: 'tour-lengths', options: Object.values(TOUR_LENGTHS).map((l) => ({ id: l.id, name: `${l.name.replace(' Tour', '')} · ${l.rounds}` })) },
    field: { el: 'tour-fields', options: Object.values(TOUR_FIELDS).map((f) => ({ id: f.id, name: f.name })) },
    format: { el: 'tour-formats', options: Object.values(TOUR_FORMATS).map((f) => ({ id: f.id, name: f.name })) },
  };
  const inputs = {};
  for (const [group, { el, options }] of Object.entries(groups)) {
    inputs[group] = options.map((option) => {
      const label = document.createElement('label');
      label.className = 'station';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `tour-${group}`;
      input.value = option.id;
      input.dataset.group = group;
      const name = document.createElement('span');
      name.textContent = option.name;
      label.append(input, name);
      $(el).append(label);
      input.addEventListener('change', () => onChoice(group, option.id));
      return input;
    });
  }

  // A list of rows: place, a colour chip, a name, a score and points, and an optional note.
  function fill(id, rows) {
    const list = $(id);
    list.replaceChildren(...rows.map((row) => {
      const li = document.createElement('li');
      if (row.player) li.dataset.player = 'true';
      if (row.kind) li.dataset.kind = row.kind;
      if (row.medal) li.dataset.medal = row.medal;
      const cell = (className, text) => { const span = document.createElement('span'); span.className = className; span.textContent = text; return span; };
      const chip = cell('tour-chip', '');
      if (row.color) chip.style.setProperty('--chip', row.color);
      li.append(cell('tour-place', row.place ?? ''), chip, cell('tour-name', row.name), cell('tour-score', row.score ?? ''),
        cell('tour-points', row.points ?? ''), cell('tour-move', row.move ?? ''));
      if (row.title) li.title = row.title;
      return li;
    }));
  }

  const colorOf = (id) => (id === PLAYER_ID ? '#ffb627' : RIVAL[id]?.color ?? '#b8b3a5');
  const settings = (t) => `${TOUR_LENGTHS[t.length].name} · ${TOUR_FIELDS[t.field].name} · ${t.handling === 'revised' ? 'Power' : 'Classic'}`;
  const pts = (n) => (n === 1 ? '1 pt' : `${n} pts`);

  function standingsRows(t, before = null) {
    if (t.format === 'targets') return [];
    const after = standings(t);
    const was = before ? Object.fromEntries(before.map((r) => [r.id, r.position])) : null;
    return after.map((r) => {
      const delta = was ? was[r.id] - r.position : 0;
      return { place: ordinal(r.position), name: r.name, color: colorOf(r.id), score: '', points: String(r.points), player: r.player,
        move: !was || t.results.length < 2 ? '' : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '–' };
    });
  }

  function targetsSummary(t) {
    const medals = { gold: 0, silver: 0, bronze: 0 };
    for (const r of t.results) if (r.medal) medals[r.medal] += 1;
    return [
      { place: '', name: 'Tour points', score: '', points: `${tourPoints(t)} / ${targetsMaximum(t)}` },
      ...TARGET_MARKS.map((m) => ({ place: '', name: m.name, medal: m.id, score: '', points: `× ${medals[m.id]}`, color: `var(--${m.id})` })),
    ];
  }

  // One sentence on what this round decides, from the posted scores (tour.js roundStakes).
  function stakesText(t, jokerArmed) {
    const st = roundStakes(t, { joker: jokerArmed });
    if (!st) return '';
    const or = (p) => (p === 1 ? 'win the round' : `finish P${p} or better`);
    const anyPlace = RIVALS.length + 1;
    if (st.final) {
      if (st.champion === anyPlace) return 'Final round: the title is already yours. Drive for the round win.';
      if (st.champion) return `Final round: you are champion if you ${or(st.champion)}.`;
      if (st.podium) return `Final round: the title is out of reach. ${or(st.podium)[0].toUpperCase()}${or(st.podium).slice(1)} for a podium.`;
      return 'Final round: no podium is in reach, but every place still counts.';
    }
    if (st.lead === anyPlace) return 'You stay top of the table whatever happens here.';
    if (st.lead) return `${or(st.lead)[0].toUpperCase()}${or(st.lead).slice(1)} and you lead the Tour.`;
    return titleOpen(t) === false ? 'The title is out of reach, but every place still counts.'
      : 'Nothing you do here can take the lead yet: score big and stay in touch.';
  }

  return {
    inputs,
    groupOf: (input) => input?.dataset?.group ?? null,

    renderMenu({ choice, handlingName, handlingId, active, bests, notice, storeNote, device }) {
      for (const [group, list] of Object.entries(inputs)) for (const input of list) input.checked = input.value === choice[group];
      const pill = $('tour-handling');
      pill.dataset.handling = handlingId;
      setText('tour-handling', `${handlingName} handling.${device === 'keyboard' ? ' Press H to change it.' : ''}`);
      const format = TOUR_FORMATS[choice.format];
      const length = TOUR_LENGTHS[choice.length];
      const field = TOUR_FIELDS[choice.field];
      setText('tour-choice-note', `${length.rounds} circuits, three laps each (about ${length.rounds === 4 ? '10' : '20'} minutes). The final round counts double; your Joker doubles one other round. ${plural(length.restarts, 'restart')} for the whole Tour. ${field.name}: ${field.summary} ${format.summary}`);
      const key = bestsKey({ ...choice, handling: handlingId });
      const best = bests?.[key];
      setText('tour-best', !best ? `No ${length.name} finished here yet.`
        : choice.format === 'series'
          ? `Here: ${plural(best.finished, 'Tour')} finished · ${plural(best.champion, 'title')} · best finish ${best.bestPlace ? ordinal(best.bestPlace) : '--'} · best ${pts(best.bestPoints ?? 0)}`
          : `Here: ${plural(best.finished, 'Tour')} finished · best medal ${best.bestTrophy ? MEDAL_NAME[best.bestTrophy] : 'none'} · best ${pts(best.bestPoints ?? 0)}`);
      const box = $('tour-continue');
      box.hidden = !active;
      if (active) {
        const s = active.format === 'series' ? standings(active).find((r) => r.player) : null;
        const where = active.results.length === 0 ? 'Not started'
          : s ? `${ordinal(s.position)} on ${pts(s.points)}` : `${pts(tourPoints(active))}`;
        setText('tour-continue-text', `${settings(active)} · ${TOUR_FORMATS[active.format].name} · Round ${active.round + 1} of ${active.lineup.length}: ${trackName(active.lineup[active.round])}. ${where}.`);
      }
      setText('tour-start', active ? 'New Tour' : 'Start Tour');
      setText('tour-notice', notice ?? '');
      setText('tour-store-note', storeNote ?? '');
    },

    renderIntro(t, { jokerArmed, pb, device }) {
      const i = t.round;
      const id = t.lineup[i];
      const meta = trackMeta(id);
      $('tour-round').style.setProperty('--track-accent', meta.accent);
      setText('tour-round-eyebrow', `${settings(t)} · Round ${i + 1} of ${t.lineup.length}${i === t.lineup.length - 1 ? ' · Final round' : ''}`);
      setText('tour-round-title', trackName(id));
      setText('tour-round-venue', meta.blurb);
      if (t.format === 'series') {
        setText('tour-marks-head', 'Scores to beat');
        fill('tour-marks', t.marks[i].map((m, place) => ({ place: ordinal(place + 1), name: m.name, color: colorOf(m.id), score: formatNumber(m.score),
          points: pts(SERIES_POINTS[place] * roundMultiplier(t, i)), title: RIVAL[m.id]?.tagline })));
        setText('tour-standings-head', i === 0 ? 'The field' : 'Standings');
        fill('tour-round-standings', i === 0
          ? RIVALS.map((r) => ({ place: '', name: r.name, color: r.color, score: '', points: '', title: r.tagline, move: '' })).concat([{ place: '', name: 'You', color: colorOf(PLAYER_ID), player: true }])
          : standingsRows(t));
      } else {
        setText('tour-marks-head', 'Targets');
        fill('tour-marks', t.marks[i].map((m) => ({ place: '', name: m.name, medal: m.id, color: `var(--${m.id})`, score: formatNumber(m.score),
          points: pts(TARGET_MARKS.find((x) => x.id === m.id).points * roundMultiplier(t, i)) })));
        setText('tour-standings-head', 'Your Tour');
        fill('tour-round-standings', targetsSummary(t));
      }
      const jokerChances = t.lineup.filter((_, k) => k >= i && roundMultiplier(t, k) === 1).length;
      const final = roundMultiplier(t, i) > 1 ? 'Final round: double points for everyone. ' : '';
      setText('tour-lineup', `Lineup: ${t.lineup.map((id, k) => (k === i ? `[${trackName(id)}]` : trackName(id))).join(' → ')}`);
      setText('tour-stakes', stakesText(t, jokerArmed));
      setText('tour-round-pb', pb === null ? 'No personal best here yet in this handling.' : `Your best score here: ${formatNumber(pb)}.`);
      const jokerNote = t.jokerRound !== null ? `Joker used in round ${t.jokerRound + 1}.`
        : !jokerAllowed(t) ? 'Joker unplayed: it cannot be played in the final round.'
          : jokerArmed ? `Joker played: your points here ×${JOKER_MULTIPLIER}.` : `Joker unplayed${jokerChances === 1 ? ': last chance to play it' : ''}.`;
      setText('tour-round-note', `${final}${plural(t.restartsLeft, 'restart')} left for the Tour. ${jokerNote} You drive last.`);
      const joker = $('tour-joker');
      joker.hidden = !jokerAllowed(t);
      joker.setAttribute('aria-pressed', jokerArmed ? 'true' : 'false');
      joker.dataset.armed = jokerArmed ? 'true' : 'false';
      joker.textContent = jokerArmed ? 'Joker played ×2' : 'Play Joker';
    },

    renderResult(t, { before, newBests, run, notice }) {
      const i = t.results.length - 1;
      const r = t.results[i];
      const id = r.trackId;
      $('tour-result').dataset.place = r.position ?? '';
      $('tour-result').dataset.medal = r.medal ?? '';
      setText('tour-result-eyebrow', `${settings(t)} · Round ${i + 1} of ${t.lineup.length} · ${trackName(id)}`);
      const joker = r.joker ? ` · Joker ×${JOKER_MULTIPLIER}` : '';
      if (t.format === 'series') {
        setText('tour-result-title', r.dnf ? 'Did not finish' : r.position === 1 ? 'Round win' : `${ordinal(r.position)} in the round`);
        setText('tour-result-line', `${formatNumber(r.score)} drift points · ${pts(r.points)}${joker}`);
        setText('tour-result-round-head', 'Round');
        fill('tour-result-round', roundTable(t, i).map((row) => ({ place: ordinal(row.position), name: row.name, color: colorOf(row.id), score: row.dnf ? 'DNF' : formatNumber(row.score),
          points: `+${row.points}`, player: row.player })));
        setText('tour-result-standings-head', 'Standings');
        fill('tour-result-standings', standingsRows(t, before));
      } else {
        setText('tour-result-title', r.medal ? `${MEDAL_NAME[r.medal]}` : r.dnf ? 'Did not finish' : 'No medal');
        setText('tour-result-line', `${formatNumber(r.score)} drift points · ${pts(r.points)}${joker}`);
        setText('tour-result-round-head', 'Targets');
        fill('tour-result-round', roundTable(t, i).map((row) => ({ place: '', name: row.name, medal: row.player ? r.medal : row.id, color: row.player ? colorOf(PLAYER_ID) : `var(--${row.id})`,
          score: row.dnf ? 'DNF' : formatNumber(row.score), points: row.player ? `+${row.points}` : '', player: row.player })));
        setText('tour-result-standings-head', 'Your Tour');
        fill('tour-result-standings', targetsSummary(t));
      }
      const notes = [];
      if (newBests?.score) notes.push(`New best score on ${trackName(id)}.`);
      if (newBests?.fastestLap) notes.push('New fastest lap.');
      if (run?.voidedLaps) notes.push(`${plural(run.voidedLaps, 'lap')} not counted (${formatNumber(run.forfeited)} points left out).`);
      const next = t.lineup[t.round];
      if (next) notes.push(`Next: ${trackName(next)}.`);
      if (t.format === 'series' && titleOpen(t) === false) notes.push('The title is out of reach now. Podium places still count.');
      setText('tour-result-notes', [notice, ...notes].filter(Boolean).join(' '));
    },

    renderFinal(t, { before, best, previousBest, notice }) {
      const o = tourOutcome(t);
      const sheet = $('tour-final');
      sheet.dataset.trophy = o.trophy ?? '';
      setText('tour-final-eyebrow', `${settings(t)} · ${TOUR_FORMATS[t.format].name} · Tour code ${t.code}`);
      if (t.format === 'series') {
        setText('tour-final-title', o.place === 1 ? 'Tour champion' : o.place === 2 ? 'Runner-up' : o.place === 3 ? 'Third overall' : `Finished ${ordinal(o.place)}`);
        const wins = t.results.filter((r) => r.position === 1).length;
        setText('tour-final-line', `${pts(o.points)} · ${plural(wins, 'round win')}${o.sweep ? ' · Clean sweep' : ''}`);
        setText('tour-final-standings-head', 'Final standings');
        fill('tour-final-standings', standingsRows(t, before));
      } else {
        setText('tour-final-title', o.trophy ? `${MEDAL_NAME[o.trophy]} Tour` : 'Tour complete');
        setText('tour-final-line', `${pts(o.points)} of ${targetsMaximum(t)}${o.sweep ? ' · Gold everywhere' : ''}`);
        setText('tour-final-standings-head', 'Your Tour');
        fill('tour-final-standings', targetsSummary(t));
      }
      fill('tour-final-rounds', t.results.map((r, i) => ({ place: `R${i + 1}`, name: trackName(r.trackId), color: trackMeta(r.trackId).accent,
        score: r.dnf ? 'DNF' : formatNumber(r.score), points: `${r.position ? ordinal(r.position) : r.medal ? MEDAL_NAME[r.medal] : '–'} · ${pts(r.points)}${r.joker ? ' (Joker)' : ''}`,
        medal: r.medal ?? undefined })));
      const improved = !previousBest || (best && ((best.bestPoints ?? 0) > (previousBest.bestPoints ?? 0)
        || (t.format === 'series' && (best.bestPlace ?? 99) < (previousBest.bestPlace ?? 99))));
      const bestLine = !best ? '' : t.format === 'series'
        ? `${improved ? 'New Tour best here. ' : ''}${plural(best.finished, 'Tour')} finished here · ${plural(best.champion, 'title')} · best ${ordinal(best.bestPlace ?? 6)}, ${pts(best.bestPoints ?? 0)}.`
        : `${improved ? 'New Tour best here. ' : ''}${plural(best.finished, 'Tour')} finished here · best ${best.bestTrophy ? MEDAL_NAME[best.bestTrophy] : 'no medal'}, ${pts(best.bestPoints ?? 0)}.`;
      setText('tour-final-best', [notice, bestLine].filter(Boolean).join(' '));
      const c = scoringComparison(t);
      setText('tour-compare', `Research · the same drives under other Tour scoring: raw total ${formatNumber(c.raw)} · normalised ${formatNumber(c.normalised)} (par ${formatNumber(1000 * t.results.length)}) · medals ${c.medals} of ${c.medalsMax}.`);
    },

    // The HUD panel, every frame. Returns where the player stands, for the overtaking banners.
    updateHud(t, round, { score, comboValue, jokerArmed }) {
      const s = standing(t, round, score);
      const panel = $('tour-hud');
      const st = t.format === 'series' && round === t.lineup.length - 1 ? roundStakes(t, { joker: jokerArmed }) : null;
      const target = !st?.champion ? '' : st.champion === RIVALS.length + 1 ? ' · Title won' : ` · Title: ${st.champion === 1 ? 'win' : `P${st.champion}`}`;
      setText('tour-hud-round', `${round === t.lineup.length - 1 ? `Final round${roundMultiplier(t, round) > 1 ? ' ×2' : ''}` : `Round ${round + 1}/${t.lineup.length}`}${jokerArmed ? ' · Joker ×2' : ''}${target}`);
      panel.dataset.joker = jokerArmed ? 'true' : 'false';
      if (t.format === 'series') {
        setText('tour-hud-place', ordinal(s.position));
        panel.dataset.place = String(s.position);
        const marks = t.marks[round];
        const leadBy = s.position === 1 ? score - (marks[0]?.score ?? 0) : 0;
        setText('tour-hud-next', s.next ? `Next: ${RIVAL[s.next.id]?.short ?? s.next.name} ${formatNumber(s.next.score)} · +${formatNumber(s.gap)}`
          : `Leading by ${formatNumber(leadBy)}`);
        const banked = score + comboValue;
        const gain = comboValue > 0 ? standing(t, round, banked).position : s.position;
        setText('tour-hud-bank', gain < s.position ? `Bank it → ${ordinal(gain)}` : '');
      } else {
        setText('tour-hud-place', s.medal ? MEDAL_NAME[s.medal] : '—');
        panel.dataset.place = s.medal ?? 'none';
        setText('tour-hud-next', s.next ? `Next: ${s.next.name} ${formatNumber(s.next.score)} · +${formatNumber(s.gap)}` : 'Gold secured');
        const banked = standing(t, round, score + comboValue).medal;
        const rank = (m) => ({ gold: 3, silver: 2, bronze: 1 })[m] ?? 0;
        setText('tour-hud-bank', comboValue > 0 && rank(banked) > rank(s.medal) ? `Bank it → ${MEDAL_NAME[banked]}` : '');
      }
      return s;
    },
  };
}
