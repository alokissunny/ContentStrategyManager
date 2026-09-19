import React, { Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureProjects, useProjects } from '../lib/projectsStore';
import { startPlanGeneration } from '../lib/planGeneration';
import { subscribeCaptureIdea } from '../lib/captureUi';

const CaptureChat = React.lazy(() => import('../pages/Projects').then((m) => ({ default: m.CaptureChat })));

/**
 * Mounts CaptureChat once for the whole dashboard when anything calls
 * openCaptureIdea() — sidebar, empty-day menus, etc. (bauhly-v3 CaptureHost).
 */
export default function CaptureHost() {
  const [open, setOpen] = useState(false);
  const projects = useProjects();
  const navigate = useNavigate();

  useEffect(() => subscribeCaptureIdea(() => {
    ensureProjects({ lite: true })
      .catch(() => {})
      .finally(() => setOpen(true));
  }), []);

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <CaptureChat
        defaultProjectId={projects[0]?.id}
        exitLabel="Back"
        onExit={() => setOpen(false)}
        onViewProject={() => { setOpen(false); navigate('/dashboard/projects'); }}
        onCaptured={() => {
          setOpen(false);
          startPlanGeneration('capture').catch(() => {});
        }}
      />
    </Suspense>
  );
}
