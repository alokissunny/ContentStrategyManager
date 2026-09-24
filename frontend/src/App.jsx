import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/marketing/Landing';
import Auth from './pages/Auth';
import YourPlans from './pages/YourPlans';
import ProtectedLayout from './components/ProtectedLayout';

// Heavy, route-specific pages are code-split so the Calendar (/dashboard) does
// not download their JS on first load. Each becomes its own chunk, fetched only
// when its route is visited.
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Projects = lazy(() => import('./pages/Projects'));
const BrandDna = lazy(() => import('./pages/BrandDna'));
const LibrarySettings = lazy(() => import('./pages/visuallibrary/LibrarySettings'));
const CompetitorOverview = lazy(() => import('./pages/CompetitorOverview'));
const Settings = lazy(() => import('./pages/Settings'));
const ReelEditor = lazy(() => import('./pages/reeleditor/ReelEditor'));
const LinkedInCallback = lazy(() => import('./pages/LinkedInCallback'));
const MetaCallback = lazy(() => import('./pages/MetaCallback'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const DataDeletion = lazy(() => import('./pages/DataDeletion'));

function RouteFallback() {
  return <div className="ph"><p className="ph__sub">Loading…</p></div>;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/data-deletion" element={<DataDeletion />} />
        <Route path="/auth" element={<Auth />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<YourPlans />} />
          {/* Your Plans + Weekly route merged into Your Week — keep the old URL
              working for bookmarks and any lingering in-app links */}
          <Route path="/dashboard/content-route" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard/projects" element={<Projects />} />
          <Route path="/dashboard/brand-dna" element={<BrandDna />} />
          {/* The Visual Library page is removed — the Brand Kit (formerly Library
              Settings) is the one surviving surface for the studio's visual
              identity. Old URLs redirect there so bookmarks and lingering links
              still land. */}
          <Route path="/dashboard/visual-brand" element={<Navigate to="/dashboard/library-settings" replace />} />
          <Route path="/dashboard/visual-library" element={<Navigate to="/dashboard/library-settings" replace />} />
          <Route path="/dashboard/library-settings" element={<LibrarySettings />} />
          <Route path="/dashboard/competitor-overview" element={<CompetitorOverview />} />
          <Route path="/dashboard/settings" element={<Settings />} />
          {/* Experimental Reel editor (gated by the reelEditor flag; the page
              itself shows an enable prompt when the flag is off). */}
          <Route path="/dashboard/reel-editor" element={<ReelEditor />} />
          <Route path="/dashboard/linkedin/callback" element={<LinkedInCallback />} />
          <Route path="/dashboard/meta/callback" element={<MetaCallback />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
