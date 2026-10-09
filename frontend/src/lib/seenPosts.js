// `New` on the calendar: a post the studio has never opened. The server keeps
// the first open (`post.seenAt`); this keeps the ones opened in this visit so
// the tag drops at once, before any list reload.
import { useSyncExternalStore } from 'react';
import client from '../api/client';

const seen = new Set();
const sent = new Set();
const listeners = new Set();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

/** The post was clicked / put on screen — record its first open (once). */
export function markPostSeen(post) {
  const id = String(post?._id || post?.id || post || '').trim();
  if (!/^[a-f0-9]{24}$/i.test(id) || post?.seenAt) return;
  if (!seen.has(id)) { seen.add(id); emit(); }
  if (sent.has(id)) return;
  sent.add(id);
  client.post(`/posts/${id}/seen`).catch(() => { sent.delete(id); });
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Never opened, still to come (or today), not out yet. */
export function isNewPost(post) {
  if (!post || post.seenAt || post.published || post.empty) return false;
  const id = String(post._id || post.id || '');
  if (!id || seen.has(id)) return false;
  const date = String(post.date || '').slice(0, 10);
  return !date || date >= todayIso();
}

/** Re-render when a post is marked seen. */
export function useSeenPosts() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => version,
    () => version,
  );
}
