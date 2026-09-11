/**
 * Brand-aware font loading for the cover.
 *
 * Loads a curated set of Google-hosted families (covering the app's shipped faces
 * plus a few editorial alternates) and resolves any family NAME the brand asks for
 * to a real, loaded CSS stack. Unknown names fall back by category, so a cover
 * always renders in *a* brand-appropriate face rather than a broken one.
 *
 * Only latin + the weights we use are fetched, so renders stay fast.
 */
import { loadFont as inter } from '@remotion/google-fonts/Inter';
import { loadFont as bricolage } from '@remotion/google-fonts/BricolageGrotesque';
import { loadFont as instrumentSerif } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as splineMono } from '@remotion/google-fonts/SplineSansMono';
import { loadFont as playfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as fraunces } from '@remotion/google-fonts/Fraunces';
import { loadFont as dmSerif } from '@remotion/google-fonts/DMSerifDisplay';
import { loadFont as manrope } from '@remotion/google-fonts/Manrope';
import { loadFont as archivo } from '@remotion/google-fonts/Archivo';

const opt = (weights: string[]) => ({ weights, subsets: ['latin'], ignoreTooManyRequestsWarning: true } as const);

// Load once at module scope. loadFont registers its own delayRender.
const Inter = inter('normal', opt(['400', '500', '600', '700'])).fontFamily;
const Bricolage = bricolage('normal', opt(['500', '700', '800'])).fontFamily;
const InstrumentSerif = instrumentSerif('normal', opt(['400'])).fontFamily;
instrumentSerif('italic', opt(['400']));
const SplineMono = splineMono('normal', opt(['400', '500'])).fontFamily;
const Playfair = playfair('normal', opt(['400', '500', '600'])).fontFamily;
playfair('italic', opt(['500']));
const Fraunces = fraunces('normal', opt(['400', '600'])).fontFamily;
fraunces('italic', opt(['400']));
const DMSerif = dmSerif('normal', opt(['400'])).fontFamily;
const Manrope = manrope('normal', opt(['400', '600', '700', '800'])).fontFamily;
const Archivo = archivo('normal', opt(['500', '700', '800'])).fontFamily;

type Entry = { family: string; category: 'serif' | 'sans' | 'display' | 'mono' };

// Keyed by normalised family name (lowercase, no spaces/punctuation).
const REGISTRY: Record<string, Entry> = {
  inter: { family: Inter, category: 'sans' },
  manrope: { family: Manrope, category: 'sans' },
  archivo: { family: Archivo, category: 'sans' },
  splinesansmono: { family: SplineMono, category: 'mono' },
  bricolagegrotesque: { family: Bricolage, category: 'display' },
  // App ships "Cabinet Grotesk" (not on Google) → its shipped fallback.
  cabinetgrotesk: { family: Bricolage, category: 'display' },
  playfairdisplay: { family: Playfair, category: 'serif' },
  playfair: { family: Playfair, category: 'serif' },
  instrumentserif: { family: InstrumentSerif, category: 'serif' },
  fraunces: { family: Fraunces, category: 'serif' },
  dmserifdisplay: { family: DMSerif, category: 'serif' },
  dmserif: { family: DMSerif, category: 'serif' },
};

const FALLBACK_STACK: Record<Entry['category'], string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, sans-serif',
  display: 'system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, monospace',
};

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolve a requested family name to a loaded CSS font-family stack.
 * `prefer` biases the category fallback when the name is unknown.
 */
export function resolveFont(name: string, prefer: Entry['category'] = 'sans'): string {
  const key = norm(name);
  const hit = REGISTRY[key];
  if (hit) return `${hit.family}, ${FALLBACK_STACK[hit.category]}`;
  // Unknown name (e.g. a studio's uploaded font we can't fetch): keep the name
  // first so it applies if present, then a category fallback.
  const quoted = name && /\s/.test(name) ? `"${name}"` : name;
  const base = prefer === 'serif' ? Playfair : prefer === 'display' ? Bricolage : prefer === 'mono' ? SplineMono : Inter;
  return `${quoted ? `${quoted}, ` : ''}${base}, ${FALLBACK_STACK[prefer]}`;
}

export const FONT_CATEGORY_OF = (name: string): Entry['category'] =>
  REGISTRY[norm(name)]?.category || 'sans';
