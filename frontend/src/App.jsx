import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/marketing/Landing';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import YourPlans from './pages/YourPlans';
import Projects from './pages/Projects';
import BrandDna from './pages/BrandDna';
import VisualBrand from './pages/visualbrand/VisualBrandPage';
import CompetitorOverview from './pages/CompetitorOverview';
import Settings from './pages/Settings';
import MetaCallback from './pages/MetaCallback';
import ProtectedLayout from './components/ProtectedLayout';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Auth />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/dashboard" element={<YourPlans />} />
        {/* Your Plans + Weekly route merged into Your Week — keep the old URL
            working for bookmarks and any lingering in-app links */}
        <Route path="/dashboard/content-route" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard/projects" element={<Projects />} />
        <Route path="/dashboard/brand-dna" element={<BrandDna />} />
        <Route path="/dashboard/visual-brand" element={<VisualBrand />} />
        <Route path="/dashboard/competitor-overview" element={<CompetitorOverview />} />
        <Route path="/dashboard/settings" element={<Settings />} />
        <Route path="/dashboard/meta/callback" element={<MetaCallback />} />
      </Route>
    </Routes>
  );
}
