/*
 * EmptyState — the one shape a page takes when there is nothing in it yet.
 *
 * Plans and Projects had grown two different answers to the same moment: Plans
 * centred a 68px round icon over a display headline and a single primary
 * button; Projects put a 46px icon in a left-aligned dashed box with a small
 * button. Same situation, same job — say what this place is for, give one
 * obvious first move — described twice and drifting apart (Leon, July 30).
 *
 * Deliberately not a "variant" system: an empty page has one design. If a
 * screen needs something else here, it needs a different component, not another
 * flag on this one.
 *
 * TWO OPTIONAL SLOTS, AND WHY THEY ARE NOT VARIANTS (Leon, Aug 4). The Image
 * tab's "what Bauhly will do" panel is the same moment — nothing has happened
 * yet, say what this is for, give one obvious move — and it was drifting into
 * its own design again, exactly the way Plans and Projects did. So it uses this
 * component, with `visual` standing in for the icon (a before/after pair is a
 * better 30px icon than an icon) and `points` standing in for the paragraph
 * (three short lines get read; a paragraph on a working screen does not).
 * Neither changes the shape: same card, same title, same single action.
 *
 * IT IS ALSO ONE OF THE APP'S TWO SANCTIONED BRAND MOMENTS (Leon, July 31 —
 * cross-experience audit, phase 2). A working screen carries two or three brand
 * signals and no more; an empty page is not a working screen — nothing is being
 * done on it, so it can afford the marketing ground, the display face, and the
 * serif hand the landing annotates with. `note` is that hand: one short line,
 * optional, never a second paragraph.
 */

import Icon from '../../brand/Icon.jsx';

export default function EmptyState({ icon = 'route', title, children, note, action, visual = null, points = null }) {
  return (
    <div className={`empty ${visual ? 'empty--visual' : ''}`}>
      <div className="empty__card">
        {visual || (
          <span className="empty__ico">
            <Icon name={icon} size={30} strokeWidth={1.7} />
          </span>
        )}
        <h1 className="empty__title">{title}</h1>
        {children && <p className="empty__sub">{children}</p>}
        {points && (
          <ul className="empty__points">
            {points.map((t) => (
              <li key={t}>
                <Icon name="check" size={14} strokeWidth={2.5} />
                {t}
              </li>
            ))}
          </ul>
        )}
        {note && <p className="empty__note">{note}</p>}
        {action}
      </div>
    </div>
  );
}
