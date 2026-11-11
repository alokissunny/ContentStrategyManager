import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureProjects, useProjects } from '../lib/projectsStore';
import { startPlanGeneration, openNextInEditor } from '../lib/planGeneration';
import { subscribeCaptureIdea, setCaptureOpen, CAPTURE_CLOSE_MS } from '../lib/captureUi';
import { IS_NATIVE } from '../native/platform';
import { useAuth } from '../context/AuthContext';

const CaptureChat = React.lazy(() => import('../pages/Projects').then((m) => ({ default: m.CaptureChat })));

/**
 * Mounts CaptureChat once for the whole dashboard when anything calls
 * openCaptureIdea() — sidebar, empty-day menus, etc. (bauhly-v3 CaptureHost).
 *
 * The landing page mounts one too (bauhly-v3, Nov 5–6): its hero field opens
 * the same conversation with `{ landing }`. A visitor is not signed in, so the
 * box asks them to log in at their first send (see `liveIntro` in CaptureChat),
 * files the capture once they have, and hands them to the app for their plan.
 */
export default function CaptureHost() {
  const [open, setOpen] = useState(false);
  // a capture aimed at one thing (Add slide) — see lib/captureUi
  const [aim, setAim] = useState(null);
  // a visit from the landing page — { origin, asks, example, draft }
  const [landing, setLanding] = useState(null);
  // the landing box shrinks back into the field before it unmounts
  const [leaving, setLeaving] = useState(false);
  // a new conversation in the SAME box (Create your own)
  const [round, setRound] = useState(0);
  const leaveTimer = useRef(0);
  const projects = useProjects();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  // someone who logged in from the landing box goes on to the app when it closes
  const loggedInHere = useRef(false);

  useEffect(() => () => { clearTimeout(leaveTimer.current); setCaptureOpen(false); }, []);

  useEffect(() => subscribeCaptureIdea((options) => {
    const visit = options?.landing || null;
    const aimed = !visit && options && typeof options === 'object' ? options : null;
    clearTimeout(leaveTimer.current);
    setLeaving(false);
    // the iPhone app captures in its native screen; an aimed capture (Add
    // slide) keeps the web conversation, which hands its result back here
    if (IS_NATIVE && !aimed && !visit) {
      import('../native/capture').then((m) => {
        if (m.hasNativeCapture()) return m.openNativeCapture();
        setAim(null);
        setOpen(true);
        return null;
      }).catch(() => { setAim(null); setOpen(true); });
      return;
    }
    setAim(aimed);
    setLanding(visit);
    if (visit) {
      loggedInHere.current = false;
      setRound((r) => r + 1);
      setOpen(true);
      setCaptureOpen(true);
      // a visitor has no projects to load; a signed-in one files as usual
      if (userRef.current) ensureProjects({ lite: true }).catch(() => {});
      return;
    }
    ensureProjects({ lite: true })
      .catch(() => {})
      .finally(() => { setOpen(true); setCaptureOpen(true); });
  }), []);

  const close = (then = null) => {
    setCaptureOpen(false);
    if (!landing) {
      setOpen(false);
      then?.();
      return;
    }
    setLeaving(true);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      setLeaving(false);
      setOpen(false);
      setLanding(null);
      then?.();
    }, CAPTURE_CLOSE_MS);
  };

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <CaptureChat
        modal
        key={landing ? `landing-${round}` : aim ? 'aimed' : 'open'}
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
        landing={landing}
        leaving={leaving}
        onLoggedIn={() => { loggedInHere.current = true; }}
        // Create your own: the same box, emptied, asking for their own in its own words (bauhly-v3 toOwn)
        onRestart={landing ? () => {
          setLanding((l) => (l ? { ...l, draft: null, own: true, ownAsk: l.example?.ownAsk || l.ownAsk || null } : l));
          setRound((r) => r + 1);
        } : null}
        onExit={() => {
          const wasAim = aim;
          close(() => {
            wasAim?.onCancel?.();
            setAim(null);
            // a visitor who logged in here has an app to go to
            if (landing && loggedInHere.current) navigate('/dashboard');
          });
        }}
        onViewProject={() => close(() => navigate('/dashboard/projects'))}
        onCaptured={(captured) => {
          if (aim?.onSaved) {
            const done = aim.onSaved;
            setOpen(false);
            setCaptureOpen(false);
            setAim(null);
            done(captured);
            return;
          }
          if (landing) {
            /* somebody who made (or logged into) their account in this box: their first post opens in the Editor */
            if (loggedInHere.current) openNextInEditor();
            close(() => navigate('/dashboard'));
            /* the box already made it, showing its progress (CaptureChat visitorGenerate) */
            if (!captured?.generated) startPlanGeneration('capture', { label: captured?.text }).catch(() => {});
            return;
          }
          setOpen(false);
          setCaptureOpen(false);
          startPlanGeneration('capture', { label: captured?.text }).catch(() => {});
        }}
      />
    </Suspense>
  );
}
