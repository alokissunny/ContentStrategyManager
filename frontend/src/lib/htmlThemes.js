// HTML themes (experimental) — Editor ⋯ › Theme › HTML themes.
// The templates live on the server (backend/src/services/htmlThemes.js); the
// menu fetches them with a sample preview each (GET /posts/html-themes).

// every family the templates use — loaded into a slide frame only when one of
// its slides wears an HTML theme (DynamicLayout). Same URL as the server's.
export const HTML_THEME_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,500;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Great+Vibes&family=Italiana&family=Jost:wght@300;400;500;600&family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,500&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap';

export const usesHtmlTheme = (html) => /\sdata-html-theme\s*=/.test(String(html || ''));

// the template a slide wears, read off its article
export const htmlThemeIdOf = (html) => String(html || '').match(/\sdata-html-theme\s*=\s*"([^"]+)"/)?.[1] || '';

// picture frames on a slide (filled or empty) — the image picker offers one slot each
export const imageSlotCount = (html) => (String(html || '').match(/<img\b[^>]*data-slot\s*=\s*["'](?:image|illustration)["']/gi) || []).length;
