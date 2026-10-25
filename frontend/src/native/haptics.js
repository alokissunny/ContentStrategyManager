// A light tap of the iPhone's haptic engine as a slide snaps into place. Only
// the Capacitor app (IS_NATIVE) loads the plugin; on the web this does nothing.
import { IS_NATIVE } from './platform';

let haptics = null;

export function slideTick() {
  if (!IS_NATIVE) return;
  haptics = haptics || import('@capacitor/haptics');
  haptics
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
    .catch(() => {});
}
