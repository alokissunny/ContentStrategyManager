const crypto = require('crypto');
const mongoose = require('mongoose');
const PlannedPost = require('../models/PlannedPost');
const PostEditLog = require('../models/PostEditLog');

// Records what the studio does to its planned posts (models/PostEditLog.js) for
// the backoffice's Customers › Activity › Edits. Mounted on /api/posts after
// `protect`: snapshots the post before a mutating request, and once the response
// has gone out with a 2xx, snapshots it again and writes the difference. Never
// blocks or fails the request — logging errors are only printed.

const MERGE_WINDOW_MS = 3 * 60 * 1000; // editor autosaves fold into one row
const CLIP = 280;

// route (relative to /api/posts) → what the studio did. `null` = not logged
// (automatic reads/caches: seen, photo focus, theme-region mapping).
const POST_ACTIONS = [
  { method: 'PATCH', re: /^\/([^/]+)$/, action: 'edit' },
  { method: 'DELETE', re: /^\/([^/]+)$/, action: 'delete', label: 'Deleted the post' },
  { method: 'POST', re: /^\/([^/]+)\/layout$/, action: 'layout', label: 'Re-ran the layout' },
  { method: 'POST', re: /^\/([^/]+)\/slide\/(\d+)\/layout-variations$/, action: 'layout-options', label: 'Opened layout options' },
  { method: 'POST', re: /^\/([^/]+)\/theme-image$/, action: 'theme', label: 'Applied a theme from a reference' },
  { method: 'POST', re: /^\/([^/]+)\/remove-theme$/, action: 'theme', label: 'Removed the theme' },
  { method: 'POST', re: /^\/([^/]+)\/slide\/(\d+)\/theme-region$/, action: 'theme-region', label: 'Edited part of a themed slide' },
  { method: 'POST', re: /^\/([^/]+)\/refine$/, action: 'refine', label: 'Asked Bauhly to refine the post' },
  { method: 'POST', re: /^\/([^/]+)\/slides$/, action: 'add-slide', label: 'Added a slide' },
  { method: 'POST', re: /^\/([^/]+)\/cover$/, action: 'cover', label: 'Made a video cover' },
  { method: 'POST', re: /^\/([^/]+)\/polish-caption$/, action: 'polish-caption', label: 'Polished the caption' },
];
const CALENDAR_ACTIONS = [
  { method: 'POST', re: /^\/distribute$/, action: 'distribute', label: 'Distributed posts onto publishing days' },
  { method: 'POST', re: /^\/shift$/, action: 'shift', label: 'Shifted posts on the calendar' },
  { method: 'DELETE', re: /^\/?$/, action: 'clear', label: 'Cleared upcoming posts' },
];

const clip = (v) => {
  const s = String(v ?? '').trim();
  return s.length > CLIP ? `${s.slice(0, CLIP - 1)}…` : s;
};
const hash = (s) => (s ? crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 10) : '');
const slidesSay = (n) => `${n} ${n === 1 ? 'slide' : 'slides'}`;
const keyTail = (k) => String(k || '').split('/').pop();

const SNAP_FIELDS = '-agentTrace -photoFocus -content.slides.layoutOptions -content.slides.themeRegions';

// The carousel document (content.carouselHtml) is where Editor mode writes most
// changes — retyped words, moved/resized blocks, photos — so each
// <article class="slide"> is read as its visible text plus a hash of its markup.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };
function textOf(html) {
  return String(html || '')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
// in post slide order: each article's data-index is its slide number (a Theme
// Apply slide sits in its own <section>, often after the rest in the document)
function docSlides(html) {
  const out = [];
  String(html || '').replace(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi, (m, attrs, inner) => {
    if (!/\bclass\s*=\s*["'][^"']*\bslide\b/i.test(attrs)) return m;
    const n = Number((/\bdata-index\s*=\s*["']?(\d+)/i.exec(attrs) || [])[1]);
    out.push({ at: Number.isFinite(n) && n > 0 ? n : out.length + 1, pos: out.length, text: textOf(inner), design: hash(m.replace(/>[^<]*</g, '><')) });
    return m;
  });
  return out.sort((x, y) => x.at - y.at || x.pos - y.pos);
}

function snap(p) {
  const c = p.content || {};
  return {
    title: p.title || '',
    date: p.date || '',
    time: p.time || '',
    published: Boolean(p.published),
    scheduledAt: p.scheduledAt ? new Date(p.scheduledAt).toISOString() : '',
    savedForReview: Boolean(p.savedForReview),
    caption: c.caption || '',
    cta: c.cta || '',
    hashtags: (c.hashtags || []).join(' '),
    themeId: c.themeId || '',
    cover: c.coverVideo?.key || '',
    html: c.carouselHtml || '',
    doc: docSlides(c.carouselHtml),
    docHash: hash(c.carouselHtml),
    slides: (c.slides || []).map((s) => ({
      title: s.title || '',
      subtitle: s.subtitle || '',
      body: s.body || '',
      photo: [s.assetKey, ...(s.assetKeys || [])].filter(Boolean).map(keyTail).join(', '),
      image: keyTail(s.image),
      layout: hash(s.layoutHtml),
      colorSet: s.colorSet || '',
      ground: s.ground || '',
      logoMark: s.logoMark || '',
      layoutTheme: s.layoutTheme || '',
    })),
  };
}

const POST_FIELDS = [
  ['title', 'Title'], ['date', 'Date'], ['time', 'Time'], ['caption', 'Caption'], ['cta', 'Call to action'],
  ['hashtags', 'Hashtags'], ['themeId', 'Theme'], ['cover', 'Video cover'],
];
const SLIDE_FIELDS = [
  ['title', 'title'], ['subtitle', 'subtitle'], ['body', 'body'], ['photo', 'photo'], ['image', 'image'],
  ['layout', 'layout'], ['colorSet', 'colour set'], ['ground', 'background'], ['logoMark', 'logo'],
  ['layoutTheme', 'theme'],
];

function diff(a, b) {
  const out = [];
  const push = (field, before, after) => out.push({ field, before: clip(before), after: clip(after) });
  POST_FIELDS.forEach(([k, label]) => { if (a[k] !== b[k]) push(label, a[k], b[k]); });
  if (a.scheduledAt !== b.scheduledAt) push(b.scheduledAt ? 'Scheduled' : 'Unscheduled', a.scheduledAt, b.scheduledAt);
  if (a.published !== b.published) push(b.published ? 'Published' : 'Unpublished', '', '');
  if (a.savedForReview !== b.savedForReview) push(b.savedForReview ? 'Saved for review' : 'Removed from review', '', '');
  if (a.slides.length !== b.slides.length) push('Slides', slidesSay(a.slides.length), slidesSay(b.slides.length));
  const n = Math.min(a.slides.length, b.slides.length);
  for (let i = 0; i < n; i += 1) {
    SLIDE_FIELDS.forEach(([k, label]) => {
      const x = a.slides[i][k];
      const y = b.slides[i][k];
      if (x === y) return;
      // a layout is HTML — only that it changed is worth showing
      if (k === 'layout') push(`Slide ${i + 1} · layout`, '', '');
      else push(`Slide ${i + 1} · ${label}`, x, y);
    });
  }
  // the carousel document, slide by slide (only where the fields above said nothing)
  const said = new Set(out.map((c) => c.field));
  const m = Math.min(a.doc.length, b.doc.length);
  for (let i = 0; i < m; i += 1) {
    const x = a.doc[i];
    const y = b.doc[i];
    if (x.text !== y.text && !said.has(`Slide ${i + 1} · title`) && !said.has(`Slide ${i + 1} · body`)) {
      push(`Slide ${i + 1} · text`, x.text, y.text);
    } else if (x.design !== y.design && !said.has(`Slide ${i + 1} · layout`)) {
      push(`Slide ${i + 1} · design`, '', '');
    }
  }
  if (a.doc.length !== b.doc.length && !said.has('Slides')) push('Slides', slidesSay(a.doc.length), slidesSay(b.doc.length));
  if (!out.length && a.docHash !== b.docHash) push('Design', '', '');
  return out;
}

// "Edited caption, slide 2 title and slide 3 photo"
function editLabel(changes) {
  const heads = [...new Set(changes.map((c) => c.field.replace(' · ', ' ').toLowerCase()))];
  if (!heads.length) return 'Edited the post';
  const shown = heads.slice(0, 3);
  const more = heads.length - shown.length;
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return `Edited ${list}${more > 0 ? ` (+${more} more)` : ''}`;
}

// the studio's own words, where an AI action carried them
function requestOf(body) {
  if (!body || typeof body !== 'object') return '';
  for (const k of ['instruction', 'prompt', 'request', 'text', 'message', 'note']) {
    if (typeof body[k] === 'string' && body[k].trim()) return body[k];
  }
  return '';
}

async function write(entry, { merge }) {
  if (merge && entry.post) {
    const since = new Date(Date.now() - MERGE_WINDOW_MS);
    const last = await PostEditLog.findOne({
      user: entry.user, post: entry.post, action: entry.action, at: { $gte: since },
    }).sort({ at: -1 });
    if (last) {
      const byField = new Map(last.changes.map((c) => [c.field, { field: c.field, before: c.before, after: c.after }]));
      entry.changes.forEach((c) => {
        const was = byField.get(c.field);
        byField.set(c.field, was ? { ...was, after: c.after } : c);
      });
      // a field edited back to where it started is no change at all
      last.changes = [...byField.values()].filter((c) => c.before !== c.after || (!c.before && !c.after));
      last.label = editLabel(last.changes);
      if (entry.hasDocs) {
        if (!last.hasDocs) last.beforeHtml = entry.beforeHtml;
        last.afterHtml = entry.afterHtml;
        last.hasDocs = true;
      }
      last.count += 1;
      last.at = new Date();
      last.postTitle = entry.postTitle || last.postTitle;
      last.postDate = entry.postDate || last.postDate;
      await last.save();
      return;
    }
  }
  await PostEditLog.create(entry);
}

function postEditLog(req, res, next) {
  if (!['PATCH', 'POST', 'DELETE', 'PUT'].includes(req.method) || !req.user?._id) return next();
  const path = req.path;
  const onPost = POST_ACTIONS.find((r) => r.method === req.method && r.re.test(path));
  const onCal = !onPost && CALENDAR_ACTIONS.find((r) => r.method === req.method && r.re.test(path));
  if (!onPost && !onCal) return next();

  const m = onPost ? onPost.re.exec(path) : null;
  const postId = m ? m[1] : null;
  if (onPost && !mongoose.isValidObjectId(postId)) return next();
  const slideNo = m && m[2] != null ? Number(m[2]) + 1 : null;
  const userId = req.user._id;

  let body = null;
  const json = res.json.bind(res);
  res.json = (b) => { body = b; return json(b); };

  const before = onPost
    ? PlannedPost.findOne({ _id: postId, user: userId }).select(SNAP_FIELDS).lean().catch(() => null)
    : Promise.resolve(null);

  res.on('finish', () => {
    if (res.statusCode >= 300) return;
    (async () => {
      const prev = await before;
      if (onCal) {
        const moved = Number(body?.moved ?? body?.deleted ?? body?.count);
        await write({
          user: userId,
          instagramUsername: String(prev?.instagramUsername || body?.posts?.[0]?.instagramUsername || ''),
          action: onCal.action,
          label: Number.isFinite(moved) ? `${onCal.label} · ${moved}` : onCal.label,
          changes: [],
        }, { merge: false });
        return;
      }
      if (!prev) return;
      const after = onPost.action === 'delete'
        ? null
        : await PlannedPost.findOne({ _id: postId, user: userId }).select(SNAP_FIELDS).lean();
      const a = snap(prev);
      const b = after ? snap(after) : null;
      const changes = b ? diff(a, b) : [];
      const docs = b && a.docHash !== b.docHash && (a.html || b.html)
        ? { hasDocs: true, beforeHtml: a.html, afterHtml: b.html }
        : {};
      const asked = requestOf(req.body);
      if (asked) changes.unshift({ field: 'Request', before: '', after: clip(asked) });

      let { action, label } = onPost;
      if (action === 'edit') {
        if (!changes.length) return; // a save that changed nothing
        const f = new Set(changes.map((c) => c.field));
        if (f.has('Published') || f.has('Unpublished')) action = 'publish';
        else if (f.has('Scheduled') || f.has('Unscheduled') || f.has('Saved for review') || f.has('Removed from review')) action = 'schedule';
        label = action === 'edit' ? editLabel(changes)
          : changes.map((c) => c.field).filter((x) => /publish|schedul|review/i.test(x)).join(', ');
      }
      if (slideNo) label = `${label} (slide ${slideNo})`;
      await write({
        user: userId,
        instagramUsername: prev.instagramUsername || '',
        post: postId,
        postTitle: (after || prev).title || '',
        postDate: (after || prev).date || '',
        action,
        label,
        changes,
        ...docs,
      }, { merge: action === 'edit' });
    })().catch((err) => console.error('[postEditLog] could not record edit:', err.message));
  });
  return next();
}

module.exports = { postEditLog, diff, snap };
