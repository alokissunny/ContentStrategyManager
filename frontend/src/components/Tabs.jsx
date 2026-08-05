/*
 * Tabs — one component for every place the app switches between views of the
 * same thing.
 *
 * WHY IT EXISTS (Leon, Aug 1). The product had two tab shapes that had never
 * met: the plan's underlined row (Why this post · Caption · Slides · Notes) and
 * the slide editor's segmented Text/Image switch, which sat in a grey trough.
 * Two shapes for one job means the studio learns the pattern twice, and the
 * second one taught them nothing the first had not.
 *
 * The kept shape is the underline. NO GREY GROUND — the trough was a box drawn
 * around a choice that is already legible from the words, and this product
 * spends its fills on states that matter (see 13-DESIGN-SYSTEM.md). What marks
 * the selected tab is ink and a rule under it.
 *
 * `items` is `[{ id, label, icon }]`. `icon` is optional: the plan's tabs name
 * sections and carry none, the editor's name two media and do.
 */

import Icon from '../brand/Icon.jsx';

export default function Tabs({ items, value, onChange, label, size = 'md', className = '' }) {
  return (
    <div className={`tabs tabs--${size} ${className}`} role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={`tab ${value === t.id ? 'is-on' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <Icon name={t.icon} size={size === 'sm' ? 13 : 15} strokeWidth={2} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}
