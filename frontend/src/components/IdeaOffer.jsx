/*
 * BUILD REEL → THE CAPTURE MODAL'S FIRST TWO QUESTIONS (port of bauhly-v3 Nov 20, decisions 1140–1147 + the
 * guided Reel's recording chooser, decisions 1063–1123).
 *
 *   1. the idea as a lean, light ContentOpportunity (Build Reel greyed — it has been pressed; Discard live)
 *      "Let's build this Reel — how would you like to make it?"
 *        · Create with my footage   [High reach]   You film it, beat by beat, to a storyboard Bauhly writes with you.
 *        · Generate automatically                  Bauhly writes it from this capture and puts the post on your plan.
 *   2. (footage) "How would you like to record your Reel?"
 *        · Face camera · Speak while filming · Show and explain — the chosen one opens its "how it works" guide
 *        Continue → the rows lock and the idea's own questions start under them (CaptureChat seedIdea)
 *
 * The answer travels with the saved capture (`captured.offer`) so IdeaCard knows what to open: the ReelPlanner
 * in the format the recording method maps to, or a plan run that writes the post.
 */
import Icon from '../brand/Icon';
import ContentOpportunity from './ContentOpportunity';
import './contentOpportunity.css';

/* bauhly-v3 lib/reelprep.js MODES (name, line, icon, the guide's art + words) and the reel format each one
   is planned in (backend services/ideaReelPlan.js FORMATS) */
export const RECORD_MODES = [
  {
    id: 'face', name: 'Face camera', say: 'You, speaking to camera.', icon: 'clapper', format: 'talking_head_broll', // you on camera, cut with project footage (studio, 2026-11-21)
    how: { head: 'How face camera works', art: '/assets/framing/person-close-up.webp', title: 'Speak to the camera',
      say: 'Record yourself explaining what’s happening, with your face visible. You can film in your studio or on location.',
      alt: 'A person filmed close up, face and shoulders, looking at the camera' },
  },
  {
    id: 'voice', name: 'Speak while filming', say: 'You, talking through the work as you film it.', icon: 'mic', format: 'faceless_voiceover',
    how: { head: 'How this works', art: '/assets/framing/voice-over.webp', title: 'Film it and talk as you go',
      say: 'Point the camera at the work and explain what’s happening while you film.',
      alt: 'A person filming a room on a phone, with a voice waveform recording underneath' },
  },
  {
    id: 'show', name: 'Show and explain', say: 'Show yourself and the work while explaining it.', icon: 'image', format: 'talking_head_broll',
    how: { head: 'How it works', art: '/assets/framing/show-and-explain.webp', title: 'Show yourself and the work',
      say: 'Move between speaking to camera and showing the project as you explain it.',
      alt: 'A person in a half-built kitchen, turned between the camera and the room, one hand open toward the island' },
  },
];
export const formatForMode = (id) => RECORD_MODES.find((m) => m.id === id)?.format || '';

function Row({ icon, name, say, best = false, on, locked, onPick, children = null }) {
  return (
    <div className={`ck-way${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={locked}
        className={`ck-card--mode${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
        onClick={onPick}
      >
        <span className="ck-card__ico" aria-hidden="true"><Icon name={icon} size={18} strokeWidth={1.8} /></span>
        <span className="ck-card__top">
          <b>{name}</b>
          {best && <span className="ck-card__best">High reach</span>}
        </span>
        <span className="ck-card__line">{say}</span>
        <span className="ck-card__tick" aria-hidden="true"><Icon name="check" size={12} strokeWidth={3} /></span>
      </button>
      {children}
    </div>
  );
}

export default function IdeaOffer({ idea, step, way, mode, locked, onWay, onMode, onContinue, onDiscard, recordRef = null, waysRef = null }) {
  const ways = [
    { id: 'mine', icon: 'clapper', name: 'Create with my footage', best: true,
      say: 'You film it, beat by beat, to a storyboard Bauhly writes with you.' },
    { id: 'auto', icon: 'sparkle-ai', name: 'Generate automatically',
      say: 'Bauhly writes it from this capture and puts the post on your plan.' },
  ];
  return (
    <div className={`ck-offer${step === 'record' ? ' ck-offer--record' : ''}`}>
      <ContentOpportunity
        ideas={[idea]}
        tone="light"
        lean
        buildDone
        onBuild={() => {}}
        onDismiss={onDiscard || null}
      />

      <section className="ck-task" ref={waysRef}>
        <h3 className="ck-q" id="ck-opp-ways">Let&rsquo;s build this Reel — how would you like to make it?</h3>
        <div className="ck-ways">
          <div className="ck-ways__row" role="radiogroup" aria-labelledby="ck-opp-ways">
            {ways.map((r) => (
              <Row
                key={r.id}
                icon={r.icon}
                name={r.name}
                say={r.say}
                best={r.best}
                on={way === r.id}
                locked={Boolean(way)}
                onPick={() => onWay(r.id)}
              />
            ))}
          </div>
        </div>
      </section>

      {way === 'mine' && step !== 'ways' && (
        <section className="ck-task" ref={recordRef}>
          <h3 className="ck-q" id="ck-ask-q">How would you like to record your Reel?</h3>
          <div className="ck-ways">
            <div className="ck-ways__row" role="radiogroup" aria-labelledby="ck-ask-q">
              {RECORD_MODES.map((m) => (
                <Row
                  key={m.id}
                  icon={m.icon}
                  name={m.name}
                  say={m.say}
                  on={mode === m.id}
                  locked={locked}
                  onPick={() => onMode(m.id)}
                >
                  {mode === m.id && (
                    <div className="ck-way__open">
                      <div className="ck-guide">
                        <h4 className="ck-shots__head">{m.how.head}</h4>
                        <ul className="ck-shots">
                          <li className="ck-shot">
                            <img className="ck-shot__pic" src={m.how.art} alt={m.how.alt} loading="lazy" decoding="async" width="512" height="512" />
                            <span className="ck-shot__body">
                              <span className="ck-shot__name">{m.how.title}</span>
                              <span className="ck-shot__say">{m.how.say}</span>
                            </span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  )}
                </Row>
              ))}
            </div>
          </div>
          {!locked && (
            <div className="ck-task__acts">
              <button type="button" className="ck-task__go" onClick={onContinue} disabled={!mode}>Continue</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
