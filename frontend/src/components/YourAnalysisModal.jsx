/*
 * YourAnalysisModal — full analysis overview from the week plan "Your analysis".
 * Sections: verdict, account summary, strengths, opportunities, similar accounts
 * (cohort), strategic focus, how this shapes your week.
 */

import React, { useEffect, useState } from 'react';
import { getAnalysisOverview } from '../api/instagram';
import AnalysisOverviewBody from './AnalysisOverviewBody';
import './analysisOverview.css';

export default function YourAnalysisModal({ username, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getAnalysisOverview(username)
      .then((overview) => {
        if (!cancelled) setData(overview);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.response?.data?.message || "We couldn't load your analysis just now.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fmodal"
      role="dialog"
      aria-modal="true"
      aria-label="Your analysis"
      onClick={onClose}
    >
      <div className="fmodal__card an-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fmodal__scroll">
          {loading && <p className="fmodal__body">Loading your analysis…</p>}
          {!loading && error && <p className="fmodal__body">{error}</p>}
          {!loading && !error && data && <AnalysisOverviewBody data={data} />}
        </div>
        <div className="fmodal__cta">
          <button type="button" className="btn" onClick={onClose}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
