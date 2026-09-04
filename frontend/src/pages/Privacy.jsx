import React from 'react';
import { Link } from 'react-router-dom';
import { LEGAL_CSS } from './legalCss';

const updated = '4 September 2026';

export default function Privacy() {
  return (
    <main className="legal">
      <style>{LEGAL_CSS}</style>
      <div className="legal__wrap">
        <Link className="legal__back" to="/">← Bauhly</Link>
        <h1>Privacy Policy</h1>
        <p className="legal__meta">Last updated {updated}</p>

        <p>
          This Privacy Policy explains how Bauhly (“we”, “us”, or “our”) collects,
          uses, and shares information when you use Bauhly’s websites and services
          (the “Service”), including when you connect an Instagram account through Meta.
        </p>

        <h2>Who we are</h2>
        <p>
          Bauhly helps interior design studios plan and publish Instagram content.
          Contact: <a href="mailto:hello@bauhly.com">hello@bauhly.com</a>
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Account information</strong> — such as name, email address, and
            authentication details when you sign in (including via Google).
          </li>
          <li>
            <strong>Instagram / Meta account data</strong> — when you connect Meta,
            we may receive information you authorize, such as your Instagram business
            or creator account identity, profile information, media, publishing
            permissions, and related metadata needed to schedule and publish posts.
          </li>
          <li>
            <strong>Content you provide</strong> — project notes, photos, captions,
            brand settings, and other materials you upload or generate in the Service.
          </li>
          <li>
            <strong>Usage and technical data</strong> — such as device/browser type,
            IP address, log data, and approximate location derived from IP, used to
            operate, secure, and improve the Service.
          </li>
        </ul>

        <h2>How we use information</h2>
        <ul>
          <li>Provide, operate, and improve Bauhly</li>
          <li>Authenticate you and manage your account</li>
          <li>Connect to Instagram via Meta APIs to create, schedule, and publish content you request</li>
          <li>Generate content plans and layouts from materials you supply</li>
          <li>Communicate with you about the Service</li>
          <li>Prevent abuse, debug issues, and comply with legal obligations</li>
        </ul>

        <h2>How we share information</h2>
        <p>We do not sell your personal information. We may share information with:</p>
        <ul>
          <li>
            <strong>Service providers</strong> that help us run Bauhly (hosting,
            authentication, email, analytics, AI processing), under contractual
            obligations to protect your data
          </li>
          <li>
            <strong>Meta / Instagram</strong>, when you connect your account and
            instruct us to publish or manage content
          </li>
          <li>
            <strong>Legal and safety</strong> parties when required by law or to
            protect rights, safety, and the integrity of the Service
          </li>
        </ul>

        <h2>Meta / Instagram permissions</h2>
        <p>
          If you connect Instagram through Meta, Bauhly only uses the permissions
          you grant to perform features you request (such as publishing posts you
          approve). You can disconnect Meta from Bauhly settings and/or revoke access
          in your Instagram or Facebook account settings.
        </p>

        <h2>Data retention</h2>
        <p>
          We retain account and content data while your account is active and as
          needed to provide the Service. You may request deletion of your account
          data by emailing <a href="mailto:hello@bauhly.com">hello@bauhly.com</a>
          {' '}or following the instructions on our{' '}
          <Link to="/data-deletion">Data deletion</Link> page.
          We may retain limited records as required for legal, security, or
          operational purposes.
        </p>

        <h2>Security</h2>
        <p>
          We use reasonable administrative, technical, and organizational measures
          to protect information. No method of transmission or storage is completely
          secure.
        </p>

        <h2>Children</h2>
        <p>
          Bauhly is not directed to children under 13, and we do not knowingly
          collect personal information from children under 13.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>Access or update account information in the Service</li>
          <li>Disconnect Instagram / Meta access</li>
          <li>Request account or data deletion via hello@bauhly.com</li>
        </ul>

        <h2>International users</h2>
        <p>
          If you use Bauhly from outside the country where our servers are located,
          your information may be processed in other countries that may have
          different data-protection laws.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this Privacy Policy from time to time. The “Last updated”
          date at the top will change when we do. Continued use of the Service after
          an update means you accept the revised policy.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this Privacy Policy:{' '}
          <a href="mailto:hello@bauhly.com">hello@bauhly.com</a>
        </p>
        <p>
          See also our <Link to="/terms">Terms of Service</Link>.
        </p>
      </div>
    </main>
  );
}
