/*
 * Subject boxes from image analysis — percentages of the photograph
 * (origin top-left). Drives annotation label + arrow placement.
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

export function boxOf(raw) {
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

export function pointOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = clampPct(raw.x);
  const y = clampPct(raw.y);
  if (x == null || y == null) return null;
  return { x, y };
}

export function subjectNameOf(value) {
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

export function aimPoint(box, name = '', query = '', point) {
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

export function normalizeSubjects(list) {
  return (Array.isArray(list) ? list : []).map(refineSubject).filter(Boolean).slice(0, 8);
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

export function matchSubject(list, query) {
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

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function overlapsBox(x, y, box, pad = 8) {
  return x > box.x - pad && x < box.x + box.w + pad
    && y > box.y - pad && y < box.y + box.h + pad;
}

export function fmtBox(raw) {
  const box = boxOf(raw);
  if (!box) return '';
  const cx = Math.round(box.x + box.w / 2);
  const cy = Math.round(box.y + box.h / 2);
  return `${box.x},${box.y}  ${box.w}×${box.h}  · center ${cx},${cy}`;
}

export function mapBoxToCover(raw, img) {
  const box = boxOf(raw);
  if (!box || !img) return box;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const dw = img.clientWidth;
  const dh = img.clientHeight;
  if (!nw || !nh || !dw || !dh) return box;
  const scale = Math.max(dw / nw, dh / nh);
  const ox = (dw - nw * scale) / 2;
  const oy = (dh - nh * scale) / 2;
  return boxOf({
    x: (((box.x / 100) * nw * scale + ox) / dw) * 100,
    y: (((box.y / 100) * nh * scale + oy) / dh) * 100,
    w: ((box.w / 100) * nw * scale / dw) * 100,
    h: ((box.h / 100) * nh * scale / dh) * 100,
  }) || box;
}

export function mapPointToCover(raw, img) {
  const p = pointOf(raw);
  if (!p || !img) return p;
  const mapped = mapBoxToCover({ x: p.x, y: p.y, w: 2, h: 2 }, img);
  if (!mapped) return p;
  return { x: mapped.x + mapped.w / 2, y: mapped.y + mapped.h / 2 };
}

export function resolveTargetBox(annotation, subjects) {
  const targetBox = boxOf(annotation?.targetBox);
  const hit = matchSubject(subjects, annotation?.targetSubject || annotation?.text);
  if (hit?.box && targetBox && areaOf(hit.box) < areaOf(targetBox) * 0.7) {
    return { box: hit.box, source: 'analysis', subject: hit, point: hit.point };
  }
  if (targetBox) return { box: targetBox, source: 'targetBox', subject: hit, point: hit?.point };
  if (hit?.box) return { box: hit.box, source: 'analysis', subject: hit, point: hit.point };
  return { box: null, source: '', subject: hit, point: hit?.point || null };
}

export function placeFromBox(raw, opts = {}) {
  const box = boxOf(raw);
  if (!box) return null;
  const aim = aimPoint(box, opts.name || '', opts.query || '', opts.point);
  const target = {
    x: clamp(aim?.x ?? (box.x + box.w / 2), 3, 97),
    y: clamp(aim?.y ?? (box.y + box.h / 2), 3, 97),
  };
  const tryX = target.x > 50 ? [10, 16, 22] : [62, 68, 54];
  const tryY = target.y < 40 ? [46, 34, 22, 12] : [10, 16, 26, 8];
  for (const y of tryY) {
    for (const x of tryX) {
      if (y > 58) continue;
      if (!overlapsBox(x, y, box, 8)) return { label: { x, y }, target };
    }
  }
  return {
    label: { x: target.x > 50 ? 10 : 62, y: target.y > 50 ? 12 : 42 },
    target,
  };
}
