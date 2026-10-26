// Capture on iPhone: the native SwiftUI screen (ios/App/App/Capture*.swift)
// runs the conversation — voice, photos, uploads and the Capture conversation
// agent — and asks this side to do what the web app owns: filing the capture
// (addSession's shaping), saving an answer to its held question, and starting
// the plan. Only the iOS app loads this.
import { Capacitor, registerPlugin } from '@capacitor/core';
import client, { getToken } from '../api/client';
import { getLocale, translate } from '../i18n';
import { ensureProjects, createProject, addSession, resumeSession } from '../lib/projectsStore';
import { startPlanGeneration } from '../lib/planGeneration';
import { captureSttLanguages } from '../pages/checkin/recorder';
import { IS_NATIVE } from './platform';

const NativeCapture = registerPlugin('NativeCapture');

export const hasNativeCapture = () => IS_NATIVE && Capacitor.getPlatform() === 'ios';

// every line and label the native screen shows, in the UI language
const LINES = [
  'What would you like to capture today? Maybe something that happened at work, an idea, or something you noticed.',
  'Check I got this right:',
  'I missed a word in there — fill it in if you can, then send.',
  "I couldn't quite catch that — write it in, or record again.",
  'Do you have a photo or clip of this, or would you rather generate visuals later?',
  'Saved. It is ready for your next plan.',
  'Something went wrong saving that — try again in a moment?',
  "That upload didn't go through — want to try again?",
  'Generating your plan…',
  "I can't reach the microphone — let's write it instead.",
  'I missed a word in what you said — what was it?',
  'Capture', 'Close capture', 'Say it however it comes out…', 'Answer in your own words…', 'Listening…',
  'Add a photo', 'Upload a photo', 'Generate visuals', 'Nothing right now', 'Generate plan', 'Save and close',
  'Skip this question', 'Try again', 'Cleaning the words up…', 'Photo library', 'Take photo', 'Cancel',
  'Thinking…', 'Record a voice note', 'Send', 'Stop recording',
];

function speechLang() {
  try { return localStorage.getItem('bauhly.captureSpeechLang') || 'auto'; } catch { return 'auto'; }
}

/* a plain capture is filed under "No project" (made on first use), as the web
   CaptureHost files it */
async function fileCapture(payload) {
  const projects = await ensureProjects({ lite: true }).catch(() => []);
  const named = (projects || []).find((p) => String(p.name || '').trim().toLowerCase() === 'no project');
  const projectId = named ? named.id : await createProject('No project');
  const made = await addSession(projectId, {
    type: payload.type,
    text: payload.text,
    attachments: payload.attachments,
    understanding: payload.understanding,
    understandings: payload.understandings,
    conversationSummary: payload.conversationSummary,
    conversationTitle: payload.conversationTitle,
    conversationTurns: payload.conversationTurns,
    sessionKind: 'capture',
    clarifyQuestions: payload.held,
  });
  return { projectId, captureId: made?.captureId || '' };
}

const HANDLERS = {
  save: fileCapture,
  answer: (p) => resumeSession(p.projectId, p.captureId, {
    text: p.text,
    attachments: p.attachments,
    understanding: p.understanding,
    understandings: p.understandings,
    conversationSummary: p.conversationSummary,
    conversationTitle: p.conversationTitle,
    conversationTurns: p.conversationTurns,
  }).then(() => ({})),
  plan: () => {
    startPlanGeneration('capture').catch(() => {});
    return {};
  },
};

/** Opens the native Capture screen; resolves 'closed' or 'plan' when it shuts. */
export async function openNativeCapture() {
  const projects = await ensureProjects({ lite: true }).catch(() => []);
  const listener = await NativeCapture.addListener('request', async ({ id, kind, payload }) => {
    try {
      const data = await HANDLERS[kind](payload || {});
      await NativeCapture.reply({ id, ok: true, data: data || {} });
    } catch (err) {
      await NativeCapture.reply({ id, ok: false, error: String(err?.message || err) });
    }
  });
  try {
    const { result } = await NativeCapture.open({
      apiBase: client.defaults.baseURL,
      token: getToken() || '',
      locale: getLocale(),
      keywords: (projects || []).map((p) => p.name).filter(Boolean),
      sttLanguages: captureSttLanguages(speechLang()),
      strings: Object.fromEntries(LINES.map((line) => [line, translate(line)])),
    });
    return result;
  } finally {
    listener.remove();
  }
}
