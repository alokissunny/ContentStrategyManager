import React from 'react';
import { Link } from 'react-router-dom';
import { LEGAL_CSS } from './legalCss';

const updated = '4 September 2026';

export default function DataDeletion() {
  return (
    <main className="legal">
      <style>{LEGAL_CSS}</style>
      <div className="legal__wrap">
        <Link className="legal__back" to="/">← Bauhly</Link>
        <h1>User data deletion</h1>
        <p className="legal__meta">Last updated {updated}</p>

        <p>
          This page explains how to request deletion of your Bauhly account data,
          including data associated with a connected Instagram / Meta account.
        </p>

        <h2>How to request deletion</h2>
        <ol>
          <li>
            Email <a href="mailto:hello@bauhly.com">hello@bauhly.com</a> from the
            address on your Bauhly account.
          </li>
          <li>
            Use the subject line: <strong>Data deletion request</strong>.
          </li>
          <li>
            Include your Bauhly account email and, if connected, your Instagram
            username / Meta app user ID so we can locate the right records.
          </li>
        </ol>

        <h2>What we delete</h2>
        <p>When we process a verified request, we delete or anonymize:</p>
        <ul>
          <li>Your Bauhly account profile and authentication records</li>
          <li>Connected Meta / Instagram tokens and linked account metadata we store</li>
          <li>Projects, uploads, generated plans, captions, and related content associated with your account</li>
        </ul>

        <h2>Timing</h2>
        <p>
          We aim to complete deletion within <strong>30 days</strong> of verifying
          your request. You will receive an email confirmation when the request is
          received and when deletion is complete.
        </p>

        <h2>What we may retain</h2>
        <p>
          We may retain limited information when required for legal, security,
          fraud-prevention, or accounting purposes, or where deletion is not
          technically feasible immediately (in which case we isolate and then delete
          it). Published Instagram posts already on Meta’s platforms are controlled
          by Meta / Instagram — remove those from Instagram directly if needed.
        </p>

        <h2>Disconnect Meta without full deletion</h2>
        <p>
          To revoke Instagram access without deleting your Bauhly account, disconnect
          Meta in Bauhly settings and/or remove Bauhly from your Facebook/Instagram
          app settings. You can still request full data deletion using the steps above.
        </p>

        <h2>Contact</h2>
        <p>
          Data deletion questions:{' '}
          <a href="mailto:hello@bauhly.com">hello@bauhly.com</a>
        </p>
        <p>
          See also our <Link to="/privacy">Privacy Policy</Link> and{' '}
          <Link to="/terms">Terms of Service</Link>.
        </p>
      </div>
    </main>
  );
}
