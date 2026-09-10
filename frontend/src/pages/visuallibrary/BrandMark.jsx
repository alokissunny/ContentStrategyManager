import { LOGO_SLOTS } from '../../lib/identity.js';
import { isProxyUrl } from '../../api/media.js';

const CORNER = {
  'top-left': 'is-tl',
  'top-right': 'is-tr',
  'bottom-left': 'is-bl',
  'bottom-right': 'is-br',
};

export function BrandMark({ mark, position }) {
  if (!mark?.url) return null;
  const slot = LOGO_SLOTS.find((s) => s.id === mark.slot);
  return (
    <img
      className={`vl-brandmark ${CORNER[position] || 'is-tl'}${slot?.kind === 'mark' ? ' is-symbol' : ''}`}
      src={mark.url}
      alt=""
      draggable={false}
      crossOrigin={isProxyUrl(mark.url) ? 'anonymous' : undefined}
    />
  );
}
