// The media components every reel composition uses, in one place, so a
// different renderer can swap them: the server (and the in-app Player) use
// Remotion's classic <Audio>/<OffthreadVideo>; an in-browser render
// (@remotion/web-renderer) needs @remotion/media's — the frontend's spike dev
// server aliases this module (frontend/vite.config.js, REEL_WEB_MEDIA=1).
export { Audio, OffthreadVideo } from 'remotion';
