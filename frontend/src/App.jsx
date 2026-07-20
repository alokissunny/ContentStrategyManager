import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Landing from './pages/marketing/Landing';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import ContentRoute from './pages/ContentRoute';
import BrandDna from './pages/BrandDna';
import Competitors from './pages/Competitors';
import CompetitorStrategy from './pages/CompetitorStrategy';
import Settings from './pages/Settings';
import ProtectedLayout from './components/ProtectedLayout';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Auth />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/content-route" element={<ContentRoute />} />
        <Route path="/dashboard/brand-dna" element={<BrandDna />} />
        <Route path="/dashboard/competitors" element={<Competitors />} />
        <Route path="/dashboard/competitor-strategy" element={<CompetitorStrategy />} />
        <Route path="/dashboard/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
