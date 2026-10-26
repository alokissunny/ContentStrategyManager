import React, { Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureProjects, useProjects } from '../lib/projectsStore';
import { startPlanGeneration } from '../lib/planGeneration';
import { subscribeCaptureIdea } from '../lib/captureUi';
import { IS_NATIVE } from '../native/platform';

const CaptureChat = React.lazy(() => import('../pages/Projects').then((m) => ({ default: m.CaptureChat })));

/**
 * Mounts CaptureChat once for the whole dashboard when anything calls
 * openCaptureIdea() — sidebar, empty-day menus, etc. (bauhly-v3 CaptureHost).
 */
export default function CaptureHost() {
  const [open, setOpen] = useState(false);
  // a capture aimed at one thing (Add slide) — see lib/captureUi
  const [aim, setAim] = useState(null);
  const projects = useProjects();
  const navigate = useNavigate();

  useEffect(() => subscribeCaptureIdea((options) => {
    const aimed = options && typeof options === 'object' ? options : null;
    // the iPhone app captures in its native screen; an aimed capture (Add
    // slide) keeps the web conversation, which hands its result back here
    if (IS_NATIVE && !aimed) {
      import('../native/capture').then((m) => {
        if (m.hasNativeCapture()) return m.openNativeCapture();
        setAim(null);
        setOpen(true);
        return null;
      }).catch(() => { setAim(null); setOpen(true); });
      return;
    }
    setAim(aimed);
    ensureProjects({ lite: true })
      .catch(() => {})
      .finally(() => setOpen(true));
  }), []);

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <CaptureChat
        modal
        key={aim ? 'aimed' : 'open'}
        defaultProjectId={projects[0]?.id}
        presetProjectId={aim?.projectId || undefined}
        opening={aim?.opening || ''}
        // a plain capture is never asked "Which project is this for?" (bauhly-v3):
        // it files under `No project` (made on first use) and can be moved later
        projectName={aim ? (aim.projectName || '') : 'No project'}
        askProject={aim ? aim.askProject !== false : false}
        maxQuestions={Number.isFinite(aim?.maxQuestions) ? aim.maxQuestions : 4}
        askMedia={aim ? aim.askMedia !== false : true}
        savedLine={aim?.savedLine || ''}
        // a plain capture is filed without questions; they wait for Generate plan
        deferQuestions={!aim}
        exitLabel="Back"
        onExit={() => { setOpen(false); aim?.onCancel?.(); setAim(null); }}
        onViewProject={() => { setOpen(false); navigate('/dashboard/projects'); }}
        onCaptured={(captured) => {
          setOpen(false);
          if (aim?.onSaved) {
            const done = aim.onSaved;
            setAim(null);
            done(captured);
            return;
          }
          startPlanGeneration('capture').catch(() => {});
        }}
      />
    </Suspense>
  );
}
