/**
 * The studio's Brand Kit typography in a talking reel (studio review 2026-11-24: "use only the fonts
 * uploaded to the Brand Kit, respecting their roles").
 *
 * The timeline carries up to three roles — heading, body, detail — each a family with either a
 * stylesheet (Google Fonts / Fontshare) or the studio's own uploaded file. They are loaded once per
 * render tab under a delayRender, so no frame is drawn in a fallback face.
 *
 * Roles in the reel: heading = the hook's key word and every caption key word; body = lead words,
 * hook lead words and the words on drawing cards; detail = chapter labels and small annotations.
 */
import { useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import { CAPTION_FACES, LOOK_FONTS } from './fonts';

export type BrandFont = { family: string; stack?: string; css?: string; url?: string };
export type BrandFonts = { heading?: BrandFont; body?: BrandFont; detail?: BrandFont };
export type ReelFaces = { heading: string; body: string; detail: string; fromKit: boolean };

const loading = new Map<string, Promise<void>>();
const WEIGHTS = ['400', '500', '600', '700', '800'];

function load(f: BrandFont): Promise<void> {
  const id = `${f.family}|${f.css || ''}|${f.url || ''}`;
  if (!loading.has(id)) {
    loading.set(id, (async () => {
      if (typeof document === 'undefined') return;
      if (f.url) {
        const face = new FontFace(f.family, `url(${JSON.stringify(f.url)})`);
        await face.load();
        (document.fonts as unknown as { add: (f: FontFace) => void }).add(face);
      } else if (f.css) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = f.css;
        document.head.appendChild(link);
        await new Promise<void>((res) => { link.onload = () => res(); link.onerror = () => res(); });
        await Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 48px "${f.family}"`).catch(() => [])));
      }
    })().catch(() => undefined));
  }
  return loading.get(id)!;
}

const stackOf = (f: BrandFont | undefined, fallback: string) =>
  f?.family ? `${f.stack || `"${f.family}"`}, ${fallback}` : fallback;

/** loads the kit's faces (once) and returns the CSS stacks per role; falls back to the shipped faces */
export function useReelFaces(fonts?: BrandFonts | null): ReelFaces {
  useState(() => {
    const list = [fonts?.heading, fonts?.body, fonts?.detail].filter((f): f is BrandFont => Boolean(f?.family && (f.css || f.url)));
    if (!list.length) return null;
    const handle = delayRender('Brand Kit fonts', { timeoutInMilliseconds: 25000 });
    Promise.all(list.map(load)).finally(() => continueRender(handle));
    return null;
  });
  const fromKit = Boolean(fonts?.heading?.family || fonts?.body?.family);
  return {
    heading: stackOf(fonts?.heading, fonts?.body?.family ? stackOf(fonts.body, CAPTION_FACES.lead) : CAPTION_FACES.lead),
    body: stackOf(fonts?.body, CAPTION_FACES.lead),
    detail: stackOf(fonts?.detail, stackOf(fonts?.body, LOOK_FONTS.sans)),
    fromKit,
  };
}
