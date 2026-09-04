import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/marketing/Landing';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import YourPlans from './pages/YourPlans';
import Projects from './pages/Projects';
import BrandDna from './pages/BrandDna';
import VisualLibrary from './pages/visuallibrary/VisualLibrary';
import LibrarySettings from './pages/visuallibrary/LibrarySettings';
import CompetitorOverview from './pages/CompetitorOverview';
import Settings from './pages/Settings';
import MetaCallback from './pages/MetaCallback';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import DataDeletion from './pages/DataDeletion';
import ProtectedLayout from './components/ProtectedLayout';

export default function App() {
  return (
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
        {/* Visual Brand is removed — its palette/type editing lives in Library
            Settings now (the Visual Library's own settings). The old URL stays
            as a redirect so bookmarks and any lingering links still land. */}
        <Route path="/dashboard/visual-brand" element={<Navigate to="/dashboard/visual-library" replace />} />
        <Route path="/dashboard/visual-library" element={<VisualLibrary />} />
        <Route path="/dashboard/library-settings" element={<LibrarySettings />} />
        <Route path="/dashboard/competitor-overview" element={<CompetitorOverview />} />
        <Route path="/dashboard/settings" element={<Settings />} />
        <Route path="/dashboard/meta/callback" element={<MetaCallback />} />
      </Route>
    </Routes>
  );
}
