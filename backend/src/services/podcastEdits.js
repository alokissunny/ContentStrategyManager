const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
function validatePodcastEdits(value, duration = 1200) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Invalid podcast edits.');
  const out = { title: typeof value.title === 'string' ? value.title.trim().slice(0, 120) : 'Podcast' };
  for (const [type, max] of [['captions', 3000], ['overlays', 50]]) {
    if (!Array.isArray(value[type]) || value[type].length > max) throw invalid(`Too many or invalid ${type}.`);
    out[type] = value[type].map(event => {
      if (!event || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 180 || !Number.isFinite(event.start) || !Number.isFinite(event.end) || event.start < 0 || event.end > duration + .001 || event.end <= event.start) throw invalid('Text needs a valid caption, start and end within the episode.');
      const motion = event.motion ?? (type === 'captions' ? 'fade' : 'slide');
      if (!['none', 'fade', 'slide'].includes(motion)) throw invalid('Invalid text animation.');
      const fontSize = event.fontSize;
      if (fontSize != null && (!Number.isFinite(fontSize) || fontSize < 16 || fontSize > 80)) throw invalid('Text size must be 16–80.');
      const position = event.position;
      if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 5 || position.x > 95 || position.y < 5 || position.y > 95)) throw invalid('Text position must be inside the video.');
      return { text: event.text.trim(), start: event.start, end: Math.min(duration, event.end), motion, ...(fontSize != null ? { fontSize } : {}), ...(position ? { position: { x: position.x, y: position.y } } : {}) };
    });
  }
  return out;
}
module.exports = { validatePodcastEdits };
