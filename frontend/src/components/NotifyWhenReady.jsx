/*
 * "Notify me when it's ready" — offered while a plan is being built, so the
 * studio can leave (close the tab / lock the phone) and get a push when it's
 * done. Hidden where push isn't available; once on, it just says so.
 */

import React from 'react';
import Icon from '../brand/Icon';
import { enablePushNotifications, usePushStatus } from '../lib/pushNotifications';

export default function NotifyWhenReady({ variant = 'page' }) {
  const status = usePushStatus();
  if (status === 'checking' || status === 'unsupported') return null;
  const cls = `notify-ready notify-ready--${variant}`;

  if (status === 'on') {
    return (
      <p className={`${cls} is-on`} role="status">
        <Icon name="bell" size={14} strokeWidth={2.25} />
        <span>We’ll notify you when it’s ready — feel free to leave.</span>
      </p>
    );
  }
  if (status === 'denied') {
    return (
      <p className={`${cls} is-denied`}>
        <span>Notifications are blocked — allow them in your settings to hear when it’s ready.</span>
      </p>
    );
  }
  return (
    <button
      type="button"
      className={`btn ${variant === 'toast' ? 'btn--primary' : 'btn--secondary'} btn--xs ${cls}`}
      disabled={status === 'working'}
      onClick={() => enablePushNotifications()}
    >
      <Icon name="bell" size={14} strokeWidth={2.25} />
      <span>Notify me when it’s ready</span>
    </button>
  );
}
