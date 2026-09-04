import React from 'react';
import { Link } from 'react-router-dom';
import { LEGAL_CSS } from './legalCss';

const updated = '4 September 2026';

export default function Terms() {
  return (
    <main className="legal">
      <style>{LEGAL_CSS}</style>
      <div className="legal__wrap">
        <Link className="legal__back" to="/">← Bauhly</Link>
        <h1>Terms of Service</h1>
        <p className="legal__meta">Last updated {updated}</p>

        <p>
          These Terms of Service (“Terms”) govern your access to and use of Bauhly’s
          websites and services (the “Service”). By creating an account or using
          Bauhly, you agree to these Terms.
        </p>

        <h2>The Service</h2>
        <p>
          Bauhly helps interior design studios plan, compose, and publish Instagram
          content. Features may include project capture, content planning, layout
          generation, and publishing through Meta / Instagram when you connect an
          account.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>You must provide accurate account information and keep it updated.</li>
          <li>You are responsible for activity under your account.</li>
          <li>You must be at least 13 years old, and old enough to form a binding contract where you live.</li>
        </ul>

        <h2>Your content</h2>
        <p>
          You retain ownership of content you upload or create in Bauhly (photos,
          notes, captions, brand materials, and similar). You grant Bauhly a limited
          license to host, process, and display that content solely to operate the
          Service for you — including generating plans/layouts and publishing to
          Instagram when you instruct us to do so.
        </p>
        <p>
          You represent that you have the rights needed to use and publish the
          content you provide, and that it does not violate law or third-party rights.
        </p>

        <h2>Instagram / Meta</h2>
        <p>
          If you connect Instagram through Meta, you also agree to Meta’s and
          Instagram’s terms and policies. Bauhly only uses permissions you grant to
          perform actions you request. You can disconnect Meta at any time from
          Bauhly settings or from your Meta/Instagram account settings.
        </p>

        <h2>Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Misuse the Service, attempt unauthorized access, or disrupt our systems</li>
          <li>Upload unlawful, infringing, or deceptive content</li>
          <li>Use Bauhly to spam, harass, or violate platform rules (including Meta’s)</li>
          <li>Reverse engineer or resell the Service except as allowed by law</li>
        </ul>

        <h2>AI-assisted features</h2>
        <p>
          Some features use automated or AI-assisted generation. Outputs may be
          imperfect. You are responsible for reviewing content before publishing.
        </p>

        <h2>Fees</h2>
        <p>
          Paid plans, if offered, are described at purchase. Fees are non-refundable
          except where required by law or stated otherwise at checkout.
        </p>

        <h2>Disclaimer</h2>
        <p>
          The Service is provided “as is” and “as available.” To the fullest extent
          permitted by law, we disclaim warranties of merchantability, fitness for a
          particular purpose, and non-infringement. We do not guarantee uninterrupted
          or error-free operation, or specific business results from published content.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, Bauhly will not be liable for
          indirect, incidental, special, consequential, or punitive damages, or for
          lost profits, revenue, or data. Our total liability for any claim relating
          to the Service is limited to the amounts you paid us for the Service in the
          12 months before the claim.
        </p>

        <h2>Termination</h2>
        <p>
          You may stop using Bauhly at any time. We may suspend or terminate access
          if you breach these Terms or if we discontinue the Service. Provisions that
          should survive termination will survive.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these Terms. The “Last updated” date will change when we do.
          Continued use after an update means you accept the revised Terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions: <a href="mailto:hello@bauhly.com">hello@bauhly.com</a>
        </p>
        <p>
          Also see our <Link to="/privacy">Privacy Policy</Link> and{' '}
          <Link to="/data-deletion">Data deletion instructions</Link>.
        </p>
      </div>
    </main>
  );
}
