/*
 * Shift posts — propose moving one post (or that post + everything after it)
 * to a new calendar day. Mirrors bauhly-v3 YourWeek futureMove / bumpAfter:
 * published + scheduled posts are fixed; collisions push the rest down.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function isoOf(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

export function dateOf(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function mondayIndex(d) {
  return (d.getDay() + 6) % 7;
}

/** Collect `count` free pattern weekdays from `fromIso` forward, skipping `taken`. */
export function publishDates({ days, from, taken = new Set(), count }) {
  const pattern = days instanceof Set ? days : new Set(days || []);
  if (!pattern.size || count <= 0) return [];
  const out = [];
  const cursor = dateOf(from) || new Date();
  for (let i = 0; i < 800 && out.length < count; i += 1) {
    const iso = isoOf(cursor);
    if (pattern.has(mondayIndex(cursor)) && !taken.has(iso)) out.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function postIso(p) {
  return isoOf(p?.date) || String(p?.date || '').slice(0, 10);
}

function isFixed(p, metaConnected) {
  if (p?.published) return true;
  if (metaConnected && p?.scheduledAt) return true;
  return false;
}

/**
 * Propose a shift.
 * @param {object} opts
 * @param {object[]} opts.posts — calendar posts sorted by date
 * @param {string} opts.anchorId — post being moved
 * @param {string} opts.fromIso — its current date
 * @param {string} opts.toIso — pressed destination
 * @param {'one'|'future'} opts.mode
 * @param {Set<number>|null} opts.patternDays — monday-index posting days (null = free)
 * @param {boolean} opts.metaConnected
 * @returns {{ conflict: string|null, result: object|null, offPattern?: boolean }}
 */
export function proposeShift({
  posts,
  anchorId,
  fromIso,
  toIso,
  mode,
  patternDays = null,
  metaConnected = false,
}) {
  if (!fromIso || !toIso || toIso === fromIso) {
    return { conflict: null, result: null };
  }

  const list = (posts || []).filter((p) => p?._id && postIso(p));
  const dates = {};
  list.forEach((p) => { dates[String(p._id)] = postIso(p); });

  const stretch = list.filter((p) => {
    const id = String(p._id);
    const iso = dates[id];
    if (!iso) return false;
    if (isFixed(p, metaConnected)) return false;
    if (mode === 'one') return id === String(anchorId);
    return iso >= fromIso;
  });

  if (!stretch.length) return { conflict: toIso, result: null };

  const moved = stretch.map((p) => String(p._id));
  const mine = new Set(moved);
  const delta = Math.round((dateOf(toIso) - dateOf(fromIso)) / 86400000);

  /* Future + pattern: re-deal onto publishing days from the pressed day. */
  if (patternDays && patternDays.size && patternDays.size < 7 && mode === 'future') {
    if (!patternDays.has(mondayIndex(dateOf(toIso)))) {
      return { conflict: null, result: null, offPattern: true };
    }
    const taken = new Set();
    list.forEach((p) => {
      const id = String(p._id);
      if (mine.has(id)) return;
      if (isFixed(p, metaConnected)) taken.add(dates[id]);
    });
    const slots = publishDates({ days: patternDays, from: toIso, taken, count: stretch.length });
    if (slots.length < stretch.length) return { conflict: toIso, result: null };
    const next = {};
    stretch.forEach((p, i) => { next[String(p._id)] = slots[i]; });
    const spill = bumpAfter({ list, dates, next, mine, metaConnected, patternDays });
    if (!spill) return { conflict: toIso, result: null };
    return {
      conflict: null,
      result: {
        moved,
        dates: spill.dates,
        bumped: spill.bumped,
        delta,
        onPattern: true,
        start: slots[0],
      },
    };
  }

  /* Single post on a pattern day restriction: destination should be on pattern
     when a sequence pattern is active — Bauhly allows one-post anywhere. */
  const next = {};
  stretch.forEach((p) => {
    next[String(p._id)] = isoOf(addDays(dateOf(dates[String(p._id)]), delta));
  });

  const onFixed = Object.values(next).some((iso) => list.some((p) => {
    const id = String(p._id);
    return !mine.has(id) && dates[id] === iso && isFixed(p, metaConnected);
  }));
  if (onFixed) return { conflict: toIso, result: null };

  const spill = bumpAfter({ list, dates, next, mine, metaConnected, patternDays });
  if (!spill) return { conflict: toIso, result: null };
  return {
    conflict: null,
    result: { moved, dates: spill.dates, bumped: spill.bumped, delta },
  };
}

function bumpAfter({ list, dates, next, mine, metaConnected, patternDays }) {
  const used = new Set(Object.values(next));
  const others = list
    .filter((p) => !mine.has(String(p._id)) && dates[String(p._id)])
    .sort((a, b) => dates[String(a._id)].localeCompare(dates[String(b._id)]));

  const first = others.findIndex((p) => used.has(dates[String(p._id)]));
  if (first < 0) return { dates: next, bumped: [] };

  const push = others.slice(first).filter((p) => !isFixed(p, metaConnected));
  if (!push.length) return null; /* fixed post in the way */

  const stay = others.filter((p) => !push.includes(p)).map((p) => dates[String(p._id)]);
  const held = new Set([...used, ...stay]);
  const last = [...used].sort().pop();
  const after = isoOf(addDays(dateOf(last), 1));

  let slots;
  if (patternDays && patternDays.size && patternDays.size < 7) {
    slots = publishDates({ days: patternDays, from: after, taken: held, count: push.length });
  } else {
    const gap = Math.round((dateOf(after) - dateOf(dates[String(push[0]._id)])) / 86400000);
    slots = push.map((p) => isoOf(addDays(dateOf(dates[String(p._id)]), Math.max(1, gap))));
    if (slots.some((iso) => held.has(iso))) return null;
  }
  if (slots.length < push.length) return null;

  const out = { ...next };
  push.forEach((p, i) => { out[String(p._id)] = slots[i]; });
  return { dates: out, bumped: push.map((p) => String(p._id)) };
}

/** Which destination days are offered while picking (from today onward). */
export function validShiftDays({
  year,
  month,
  mode,
  patternDays,
  posts,
  metaConnected,
  floorIso,
}) {
  const spoken = new Set();
  (posts || []).forEach((p) => {
    if (isFixed(p, metaConnected)) spoken.add(postIso(p));
  });
  const out = new Set();
  const first = new Date(year, month, 1, 12, 0, 0, 0);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const start = addDays(first, -lead);
  const total = Math.ceil((lead + lastDate) / 7) * 7;
  for (let i = 0; i < total; i += 1) {
    const d = addDays(start, i);
    const iso = isoOf(d);
    if (floorIso && iso < floorIso) continue;
    if (mode !== 'one' && patternDays && patternDays.size < 7 && !patternDays.has(mondayIndex(d))) {
      continue;
    }
    if (spoken.has(iso)) continue;
    out.add(iso);
  }
  return out;
}

export { isFixed, postIso };
