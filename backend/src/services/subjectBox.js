/*
 * Subject bounding boxes from image analysis — percentages of the photograph
 * (origin top-left). Used to place on-photo annotation labels and arrows on
 * the real object instead of a nine-region guess.
 */

function clampPct(n, fallback = null) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(100, Math.round(x * 10) / 10));
}

function asNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function looksLikeUnitInterval(values) {
  const nums = values.filter((v) => v != null);
  if (!nums.length) return false;
  return nums.every((v) => v >= 0 && v <= 1) && nums.some((v) => v > 0 && v < 1);
}

function boxOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let x = asNumber(raw.x ?? raw.left);
  let y = asNumber(raw.y ?? raw.top);
  let w = asNumber(raw.w ?? raw.width);
  let h = asNumber(raw.h ?? raw.height);
  if (x == null || y == null) return null;
  if (looksLikeUnitInterval([x, y, w, h])) {
    x *= 100;
    y *= 100;
    if (w != null) w *= 100;
    if (h != null) h *= 100;
  }
  const box = {
    x: clampPct(x),
    y: clampPct(y),
    w: clampPct(w, 8),
    h: clampPct(h, 8),
  };
  if (box.x == null || box.y == null) return null;
  box.w = Math.max(2, box.w);
  box.h = Math.max(2, box.h);
  if (box.x + box.w > 100) box.w = Math.max(2, 100 - box.x);
  if (box.y + box.h > 100) box.h = Math.max(2, 100 - box.y);
  return box;
}

function pointOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = clampPct(raw.x);
  const y = clampPct(raw.y);
  if (x == null || y == null) return null;
  return { x, y };
}

function subjectNameOf(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(value.name || value.label || value.subject || '').trim();
}

function areaOf(box) {
  const hit = boxOf(box);
  return hit ? hit.w * hit.h : Infinity;
}

function isOversize(box) {
  const hit = boxOf(box);
  if (!hit) return false;
  return hit.h > 36 || hit.w > 40 || (hit.w * hit.h) > 900 || hit.h > hit.w * 2.1;
}

function isObjectName(text) {
  return /pendant|fitting|fixture|lamp|sconce|canopy|light|switch|outlet|handle|tap|faucet|knob|hinge|rail|bracket/.test(
    String(text || '').toLowerCase(),
  );
}

function boxAround(point, w, h) {
  const p = pointOf(point);
  if (!p) return null;
  const bw = Math.max(6, Math.min(18, w || 12));
  const bh = Math.max(6, Math.min(22, h || 14));
  return boxOf({
    x: p.x - bw / 2,
    y: p.y - bh / 2,
    w: bw,
    h: bh,
  });
}

function aimPoint(box, name = '', query = '', point) {
  const given = pointOf(point);
  if (given) return given;
  const hit = boxOf(box);
  if (!hit) return null;
  const text = `${name} ${query}`.toLowerCase();
  if (isOversize(hit) && (isObjectName(text) || /install|ceiling|hang/.test(text))) {
    const cx = hit.x + hit.w / 2;
    const inward = cx < 45 ? hit.x + hit.w * 0.82 : (cx > 55 ? hit.x + hit.w * 0.18 : cx);
    return {
      x: clampPct(inward),
      y: clampPct(hit.y + Math.min(10, hit.h * 0.16)),
    };
  }
  if (isOversize(hit)) {
    return {
      x: clampPct(hit.x + hit.w / 2),
      y: clampPct(hit.y + hit.h * 0.28),
    };
  }
  return {
    x: clampPct(hit.x + hit.w / 2),
    y: clampPct(hit.y + hit.h / 2),
  };
}

function refineSubject(item) {
  const name = subjectNameOf(item);
  if (!name) return null;
  let box = typeof item === 'object' ? boxOf(item.box || item) : null;
  let point = typeof item === 'object' ? pointOf(item.point) : null;
  if (!point && box) point = aimPoint(box, name);
  if (box && point && isOversize(box) && isObjectName(name)) {
    box = boxAround(point, Math.min(box.w, 14), Math.min(box.h, 18)) || box;
  }
  if (!box) return { name };
  return point ? { name, box, point } : { name, box };
}

function normalizeSubjects(list) {
  return (Array.isArray(list) ? list : []).map(refineSubject).filter(Boolean).slice(0, 8);
}

function subjectNames(list) {
  return normalizeSubjects(list).map((s) => s.name);
}

function subjectsForPlan(list, limit = 6) {
  return normalizeSubjects(list).slice(0, limit).map((s) => {
    const row = { name: s.name };
    if (s.box) row.box = s.box;
    if (s.point) row.point = s.point;
    return row;
  });
}

function tokensOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function matchScore(subject, query, words) {
  const name = subject.name.toLowerCase();
  if (name === query) return 100;
  if (name.includes(query) || (query.length >= 4 && query.includes(name))) return 70;
  if (words.some((w) => name.includes(w))) return 40;
  return 0;
}

function matchSubject(list, query) {
  const subjects = normalizeSubjects(list);
  if (!subjects.length) return null;
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return subjects
      .filter((s) => s.box)
      .sort((a, b) => areaOf(a.box) - areaOf(b.box))[0] || subjects[0];
  }
  const words = tokensOf(q);
  const ranked = subjects
    .map((s) => ({ s, score: matchScore(s, q, words) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return areaOf(a.s.box) - areaOf(b.s.box);
    });
  return ranked[0]?.s || null;
}

function regionFromBox(box) {
  const hit = boxOf(box);
  if (!hit) return '';
  const aim = aimPoint(hit);
  const cx = aim?.x ?? (hit.x + hit.w / 2);
  const cy = aim?.y ?? (hit.y + hit.h / 2);
  const col = cx < 33 ? 'left' : cx > 66 ? 'right' : '';
  const row = cy < 33 ? 'top' : cy > 66 ? 'bottom' : '';
  if (row && col) return `${row}-${col}`;
  return row || col || 'center';
}

module.exports = {
  boxOf,
  pointOf,
  aimPoint,
  subjectNameOf,
  normalizeSubjects,
  subjectNames,
  subjectsForPlan,
  matchSubject,
  regionFromBox,
};
