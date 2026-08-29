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

function subjectNameOf(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(value.name || value.label || value.subject || '').trim();
}

function normalizeSubjects(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const name = subjectNameOf(item);
      if (!name) return null;
      const box = typeof item === 'object' ? boxOf(item.box || item) : null;
      return box ? { name, box } : { name };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function subjectNames(list) {
  return normalizeSubjects(list).map((s) => s.name);
}

function subjectsForPlan(list, limit = 6) {
  return normalizeSubjects(list).slice(0, limit).map((s) => (
    s.box ? { name: s.name, box: s.box } : { name: s.name }
  ));
}

function tokensOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function matchSubject(list, query) {
  const subjects = normalizeSubjects(list);
  if (!subjects.length) return null;
  const q = String(query || '').trim().toLowerCase();
  if (!q) return subjects.find((s) => s.box) || subjects[0];
  const exact = subjects.find((s) => s.name.toLowerCase() === q);
  if (exact) return exact;
  const contains = subjects.find((s) => {
    const name = s.name.toLowerCase();
    return name.includes(q) || q.includes(name);
  });
  if (contains) return contains;
  const words = tokensOf(q);
  return subjects.find((s) => {
    const name = s.name.toLowerCase();
    return words.some((w) => name.includes(w));
  }) || null;
}

function regionFromBox(box) {
  const hit = boxOf(box);
  if (!hit) return '';
  const cx = hit.x + hit.w / 2;
  const cy = hit.y + hit.h / 2;
  const col = cx < 33 ? 'left' : cx > 66 ? 'right' : '';
  const row = cy < 33 ? 'top' : cy > 66 ? 'bottom' : '';
  if (row && col) return `${row}-${col}`;
  return row || col || 'center';
}

module.exports = {
  boxOf,
  subjectNameOf,
  normalizeSubjects,
  subjectNames,
  subjectsForPlan,
  matchSubject,
  regionFromBox,
};
