const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function GlyphPlan({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect x="3" y="3" width="20" height="20" rx="1.5" {...S} />
      <path d="M3 15h9M12 15V3M12 10h11M17 15v8" {...S} />
      <circle cx="7.5" cy="19" r="1.2" {...S} />
    </svg>
  )
}

export function GlyphSwatch({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect x="3" y="7" width="12" height="12" rx="1.5" {...S} />
      <rect x="8" y="12" width="12" height="12" rx="1.5" {...S} />
      <path d="M15 3l8 8" {...S} />
    </svg>
  )
}

export function GlyphSite({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M4 22h18M6 22V10l7-5 7 5v12" {...S} />
      <path d="M10 22v-6h6v6" {...S} />
      <path d="M2 6l3-2M24 6l-3-2" {...S} />
    </svg>
  )
}

export function GlyphRoller({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect x="4" y="4" width="15" height="6" rx="1.5" {...S} />
      <path d="M19 7h4v5h-9v4" {...S} />
      <rect x="12.5" y="16" width="3" height="7" rx="1" {...S} />
    </svg>
  )
}

export function GlyphBrief({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect x="4" y="3" width="18" height="20" rx="1.5" {...S} />
      <path d="M8 8h10M8 12h10M8 16h6" {...S} />
      <path d="M17 19l2 2 3.5-3.5" {...S} />
    </svg>
  )
}

export function GlyphDoorway({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      <path d="M14 62h44" {...S} />
      <path d="M22 62V26a14 14 0 0 1 28 0v36" {...S} />
      <circle cx="43" cy="44" r="1.6" {...S} />
      <path d="M8 62h4M60 62h4" {...S} />
    </svg>
  )
}

export function GlyphColonnade({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      <path d="M10 62h52M12 18h48M14 12h44" {...S} />
      <path d="M18 18v44M32 18v44M46 18v44M60 18v44" {...S} />
      <path d="M16 18h4M30 18h4M44 18h4M58 18h4" {...S} />
    </svg>
  )
}

export function GlyphHouse({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      <path d="M10 62h52" {...S} />
      <path d="M16 62V32l20-16 20 16v30" {...S} />
      <path d="M30 62V44h12v18" {...S} />
      <rect x="44" y="38" width="8" height="8" rx="1" {...S} />
      <path d="M36 10v6" {...S} />
    </svg>
  )
}

export function IconHeart({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 20.3C6.3 16 2.6 12.7 2.6 8.8 2.6 5.9 4.9 3.6 7.7 3.6c1.8 0 3.4.9 4.3 2.3.9-1.4 2.5-2.3 4.3-2.3 2.8 0 5.1 2.3 5.1 5.2 0 3.9-3.7 7.2-9.4 11.5Z"
        {...S}
      />
    </svg>
  )
}

export function IconComment({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.5 5.8c0-1.3 1-2.3 2.3-2.3h12.4c1.3 0 2.3 1 2.3 2.3v8.4c0 1.3-1 2.3-2.3 2.3H9.2L4.7 20V16.5h-.9c-1.3 0-2.3-1-2.3-2.3Z"
        {...S}
      />
    </svg>
  )
}

export function IconShare({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 3 3.5 10.2l7 2.9 2.9 7Z" {...S} />
      <path d="M21 3 10.4 13.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconBookmark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.6h12v16.8l-6-4.2-6 4.2Z" {...S} />
    </svg>
  )
}

export function IconPlay({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4.2 19 12 6 19.8Z" {...S} strokeLinejoin="round" fill="currentColor" />
    </svg>
  )
}

export function IconCarouselStack({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="7" width="14" height="14" rx="3" {...S} />
      <path d="M8 4.5h10a2.5 2.5 0 0 1 2.5 2.5v10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function GlyphSpark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M3 20l5-6 4 3 6-9 5 4" {...S} />
      <circle cx="23" cy="12" r="1.6" {...S} />
    </svg>
  )
}

export function IconInstagram({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" {...S} />
      <circle cx="12" cy="12" r="4.2" {...S} />
      <circle cx="17.2" cy="6.8" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
}
