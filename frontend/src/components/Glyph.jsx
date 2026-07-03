import React, { useEffect, useRef } from 'react';

export default function Glyph({ name, size = 20, color, strokeWidth = 1.5, style }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !window.lucide) return;
    ref.current.innerHTML = '';
    const el = document.createElement('i');
    el.setAttribute('data-lucide', name);
    el.setAttribute('width', size);
    el.setAttribute('height', size);
    ref.current.appendChild(el);
    window.lucide.createIcons({ attrs: { 'stroke-width': strokeWidth } });
  }, [name, size, strokeWidth]);

  return <span ref={ref} style={{ display: 'inline-flex', color, ...style }} />;
}
