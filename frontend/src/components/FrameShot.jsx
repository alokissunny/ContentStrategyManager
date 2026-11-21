/* ══ HOW TO FRAME IT ═══════════════════════════════════════════════════════════════════════════════════════════════
 *    (Leon, Nov 19 — decision 1050: "Use the newly attached illustration references… All three references must
 *     feature the same illustrated character… Demonstrate clearly different camera distances."
 *     Decision 1052 §2: "Each option must display guidance relevant to that recording approach. Do not reuse
 *     face-camera illustrations for voice-over or footage-only recording.")
 *
 * TWO KINDS OF REFERENCE LIVE HERE, and the difference between them is worth knowing before editing either.
 *
 * THE PERSON SET is Leon's own artwork, filed in `public/assets/framing/` and served the way every other picture in
 * this product is. Decision 1049 drew it as flat SVG because the product shipped no illustration library and a
 * photograph of a stranger is the stock imagery the brief rules out; it said plainly that real artwork was a drawing
 * job rather than a code one. The artwork arrived, so those drawings went.
 *
 * THE ROOM AND DETAIL SETS ARE STILL DRAWN HERE, and they are NOT Leon's artwork — 1050 and 1051 both reported that
 * a filmed beat had no references at all and drew nothing. 1052 asks for references for all three preferences, so
 * they are drawn in code, in the same family as the artwork beside them: the same square, the same warm ground, the
 * same lime corner brackets and REC mark, every colour from `--illus-*` and the brand's own tokens. They are meant
 * to be REPLACED by real files the day they exist — drop the webp into `public/assets/framing/`, add a row to `ART`,
 * and delete the drawing. The two sets are never shown together: a preference picks one set and only that one.
 */

const ART = {
  close: { src: '/assets/framing/person-close-up.webp', alt: 'A person filmed close up, face and shoulders, looking at the camera' },
  knees: { src: '/assets/framing/person-knees-up.webp', alt: 'The same person filmed from the knees up, with more of the room in shot' },
  whole: { src: '/assets/framing/person-head-to-toe.webp', alt: 'The same person filmed head to toe, standing in the room' },
  /* ── AND TWO MORE ARRIVED (Leon, Nov 19 — decision 1066) ──────────────────────────────────────────────────
     `wide` is the shot both filmed sets open on — the same person, from behind, holding the room on a phone —
     so ONE file serves Voice-over's `Wide room` and Only camera's `Wide shot`. They are the same shot asked for
     twice, and two copies of it would be two things to keep in step.
     `narrate` is not a framing at all: it is the person speaking in the space, and it illustrates the NOTE that
     a voice-over can be talked while filming or read over it afterwards. It is here rather than in the drawn
     set because it is Leon's artwork, and it is used where what it shows is true. */
  wide: { src: '/assets/framing/room-wide.webp', alt: 'A person filming the whole room on a phone, standing still at one end of it' },
  /* ── AND THE DETAIL CLOSE-UP IS ARTWORK NOW (Leon, Nov 19 — decision 1070) ───────────────────────────────
     A hand on fluted timber, the worktop edge above it — the shot `Detail close-up` has been describing since
     1067, photographed instead of drawn. The `Detail` drawing that held the slot is gone with it; that is what
     the note at the top of this file has always said a drawing is for. */
  closeup: { src: '/assets/framing/detail-closeup.webp', alt: 'A hand resting on fluted timber cabinetry, filmed close, with the worktop edge above' },
  /* ── AND HANDS AT WORK IS ARTWORK NOW (Leon, Nov 19 — decision 1082) ───────────────────────────
     Two hands fitting a hinge, one steadying it and one on the drill — which is the second half of what the
     reference has said since 1067 ("a sample held up, a hinge going on"), so the words needed no change. The
     `Hands` drawing that held the slot went with it, as the note at the top of this file says a drawing is for. */
  hands: { src: '/assets/framing/hands-at-work.webp', alt: 'Two hands fitting a hinge to a door, one steadying it and one holding a cordless drill' },
  /* ── AND ONE THAT IS NOT A FRAMING AT ALL (Leon, Nov 19 — decision 1074) ─────────────────────────────────
     `voiceover` illustrates the METHOD, not a shot: filming the room on a phone with the voice track under it,
     which is what "film first, narrate later" looks like. It is keyed here because `FrameShot` is how this
     product draws a reference-sized picture, and that is the shape the row it sits in wants — but what it
     explains is how a way of recording works, not what to point the camera at. */
  voiceover: { src: '/assets/framing/voice-over.webp', alt: 'A person filming a room on a phone, with a voice waveform recording underneath' },
  /* ── AND ONE MORE THAT EXPLAINS A METHOD RATHER THAN A FRAMING (Leon, Nov 19 — decision 1097) ───────────
     `showtell` is the third option's card: the designer half-turned between the lens and the room, one hand
     open toward the work, the island and the ladder behind her. Leon's own artwork, at the set's 1254² and in
     the set's warm palette with the lime corners and the REC mark — "keeping the same square dimensions, warm
     colours, character style, and lime framing corners as the other references."
     WHAT IT REPLACES ON THAT CARD: `wide` (room-wide.webp), a person filming a room and saying nothing. That
     file is untouched and still earns its keep — it is `Wide shot`, the unconditional last entry in the
     filming library — but it is no longer what the third method looks like, because the third method is not
     that any more (decision 1097 turns `Only camera` into `Show and explain`). */
  showtell: { src: '/assets/framing/show-and-explain.webp', alt: 'A person in a half-built kitchen, turned between the camera and the room, one hand open toward the island as she speaks' },
  /* `narrate` (room-narrating.webp) is still on disk — decision 1070 removed the note it illustrated, it did
     not throw Leon's artwork away (same as `person-waist-up.webp` since 1053) */
  /* `medium` (person-waist-up.webp) is still on disk — decision 1053 took that distance out of the set, it did
     not throw the drawing away */
};

/* the mark every reference in this set wears, artwork and drawing alike: four lime brackets and the REC dot, so a
   drawn room and a photographed person read as two shots of one thing rather than two components */
function Marks() {
  return (
    <g aria-hidden="true">
      <g fill="none" stroke="var(--experiment-500)" strokeWidth="2.6" strokeLinecap="square">
        <path d="M8 19V8h11M81 8h11v11M92 81v11H81M19 92H8V81" />
      </g>
      <circle cx="75.5" cy="13.5" r="2.4" fill="var(--signal-500)" />
      <text x="80" y="16" fontSize="6.4" fontWeight="700" fill="var(--illus-ink)" fontFamily="var(--font-ui)">REC</text>
    </g>
  );
}


/* ── ALONG THE WALL ── the same room from one end. One-point perspective: the two walls run away to a back wall,
   the floor opens towards the camera, and the run recedes with the left wall. Depth is the whole point of it. */
const Along = (
  <>
    <rect x="0" y="0" width="100" height="100" fill="var(--illus-ground)" />
    {/* ceiling, floor, then the two side walls, then the back wall last so its edge reads */}
    <path d="M0 0h100v12L70 26H34L0 10Z" fill="var(--illus-ground)" />
    <path d="M0 10 34 26v46L0 94Z" fill="var(--illus-wall)" />
    <path d="M100 12 70 26v46l30 20Z" fill="var(--illus-wall)" opacity="0.65" />
    <path d="M0 94 34 72h36l30 20v8H0Z" fill="var(--illus-ground)" />
    <rect x="34" y="26" width="36" height="46" fill="var(--illus-ground)" />
    <rect x="34" y="26" width="36" height="46" fill="none" stroke="var(--illus-form)" strokeWidth="1.3" />
    {/* the run of units along the left wall, receding with it */}
    <path d="M4 56 34 50v22L4 82Z" fill="var(--illus-form)" />
    <path d="M3 53 34 47.5v3.5L3 56.5Z" fill="var(--illus-ink)" opacity="0.26" />
    <path d="M19 53.2v24" stroke="var(--illus-ground)" strokeWidth="1.1" />
    {/* a window on the back wall, so the far end is not a blank panel */}
    <rect x="44" y="34" width="16" height="24" fill="var(--illus-wall)" />
    <path d="M44 46h16M52 34v24" stroke="var(--illus-ground)" strokeWidth="1.1" />
  </>
);



/* ── THREE DRAWINGS WENT WITH THEIR SLOTS (Leon, Nov 19 — decision 1070) ────────────────────────────────────
   `Wide` (the room square on, 1052) — `room-wide.webp` is that shot, photographed, since 1066.
   `Material` (grain filling the frame, 1052) — its slot became `closeup`, which is artwork now.
   `Detail` (two planes and a pull, 1052) — `detail-closeup.webp` is that shot, photographed, since 1070.
   This is the file working as intended rather than three deletions: a drawing holds a slot until the artwork
   for it exists, and then it goes. Four are left, and each one is a reference nobody has photographed yet. */

/* ══ THE SEVEN ASKED FOR BY NAME (Leon, Nov 19 — decision 1067 §3) ═════════════════════════════════════════════
 *    "Extend the library with: 1. Slow walkthrough 2. Detail close-up 3. Point-of-view shot 4. Hands at work
 *     5. Before and after 6. Side-by-side comparison 7. Work in progress. Maintain the same visual system,
 *     proportions, rounded corners, palette, lime recording brackets, and REC indicator."
 * No files came with that list, so they are drawn here, in the same square, the same `--illus-*` palette and the
 * same `Marks` every reference in this file wears — which is what the note at the top of this file has said a
 * drawing is FOR since 1050: it holds the slot until the artwork for it exists. Four of them are new shapes;
 * `Slow walkthrough` and `Detail close-up` are the `Along` and `Detail` drawings already here, which is what
 * those two names describe. Each one is built from the room the artwork draws, so a drawn reference and a
 * photographed one read as two shots of one place.
 */

/* ── POINT OF VIEW ── the room past a phone held up in front of it: the frame you are looking through, and your
   own hands at the bottom edge of it */
const Pov = (
  <>
    <rect x="0" y="0" width="100" height="100" fill="var(--illus-wall)" />
    <rect x="0" y="74" width="100" height="26" fill="var(--illus-ground)" />
    <path d="M0 74h100" stroke="var(--illus-form)" strokeWidth="1.2" />
    {/* the room beyond: a run of units and a tall opening */}
    <rect x="10" y="50" width="34" height="24" fill="var(--illus-form)" />
    <rect x="8" y="47" width="38" height="3.5" rx="1" fill="var(--illus-ink)" opacity="0.26" />
    <rect x="60" y="24" width="22" height="50" fill="var(--illus-ground)" />
    <rect x="60" y="24" width="22" height="50" fill="none" stroke="var(--illus-form)" strokeWidth="1.3" />
    {/* the phone, held: its screen is the same room one step smaller */}
    <rect x="22" y="36" width="56" height="34" rx="4" fill="var(--illus-ground)" stroke="var(--illus-ink)" strokeWidth="2" />
    <rect x="26" y="40" width="48" height="26" rx="2" fill="var(--illus-wall)" />
    <rect x="31" y="54" width="17" height="12" fill="var(--illus-form)" />
    <rect x="58" y="46" width="11" height="20" fill="var(--illus-ground)" stroke="var(--illus-form)" strokeWidth="1" />
    {/* the hands at the bottom corners, holding it */}
    <path d="M16 78c2-7 7-10 12-9l4 1-1 9H16Z" fill="var(--illus-skin)" stroke="var(--illus-ink)" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M84 78c-2-7-7-10-12-9l-4 1 1 9h15Z" fill="var(--illus-skin)" stroke="var(--illus-ink)" strokeWidth="1.6" strokeLinejoin="round" />
  </>
);

/* WAS HERE: the `Hands` drawing — two hands over a worktop holding a sample against it. Artwork since
   decision 1082 (`hands-at-work.webp`), and a drawing in this file is only ever a slot's placeholder. */
/* ── BEFORE AND AFTER ── one frame cut down the middle: the same wall closed in on the left, opened on the right.
   The divider is the point of the shot, so it is the strongest line in it. */
const BeforeAfter = (
  <>
    <rect x="0" y="0" width="50" height="100" fill="var(--illus-form)" />
    <rect x="50" y="0" width="50" height="100" fill="var(--illus-wall)" />
    {/* left: a small high window, a low ceiling line, the room closed */}
    <rect x="0" y="76" width="50" height="24" fill="var(--illus-ground)" opacity="0.7" />
    <rect x="12" y="30" width="14" height="16" fill="var(--illus-ground)" opacity="0.6" />
    <path d="M0 22h50" stroke="var(--illus-ink)" strokeWidth="1.2" opacity="0.3" />
    <rect x="8" y="52" width="26" height="24" fill="var(--illus-ink)" opacity="0.18" />
    {/* right: the wall gone, light and depth */}
    <rect x="50" y="76" width="50" height="24" fill="var(--illus-ground)" />
    <rect x="60" y="22" width="32" height="54" fill="var(--illus-ground)" />
    <rect x="60" y="22" width="32" height="54" fill="none" stroke="var(--illus-form)" strokeWidth="1.3" />
    <path d="M66 22v54M78 22v54" stroke="var(--illus-form)" strokeWidth="1" />
    {/* the cut */}
    <path d="M50 0v100" stroke="var(--illus-ink)" strokeWidth="2.4" />
  </>
);

/* ── SIDE BY SIDE ── two shots held up together, which is a different thing from one frame cut in half: two
   plates, a gap between them, and neither is "the before". */
const SideBySide = (
  <>
    <rect x="0" y="0" width="100" height="100" fill="var(--illus-wall)" />
    <rect x="6" y="22" width="40" height="56" rx="3" fill="var(--illus-ground)" stroke="var(--illus-ink)" strokeWidth="1.8" />
    <rect x="54" y="22" width="40" height="56" rx="3" fill="var(--illus-ground)" stroke="var(--illus-ink)" strokeWidth="1.8" />
    {/* a run of units in one, a tall opening in the other — two shots of one room */}
    <rect x="12" y="52" width="22" height="18" fill="var(--illus-form)" />
    <path d="M11 49h24" stroke="var(--illus-ink)" strokeWidth="1.6" opacity="0.3" />
    <rect x="64" y="34" width="18" height="36" fill="var(--illus-form)" opacity="0.6" />
    <path d="M73 34v36" stroke="var(--illus-ground)" strokeWidth="1.2" />
  </>
);

/* ── WORK IN PROGRESS ── the room mid-job: a ladder, a run half fitted, a panel waiting against the wall */
const Progress = (
  <>
    <rect x="0" y="0" width="100" height="76" fill="var(--illus-wall)" />
    <rect x="0" y="76" width="100" height="24" fill="var(--illus-ground)" />
    <path d="M0 76h100" stroke="var(--illus-form)" strokeWidth="1.3" />
    {/* the run: half of it fitted, half still carcass */}
    <rect x="8" y="54" width="22" height="22" fill="var(--illus-form)" />
    <rect x="30" y="54" width="22" height="22" fill="none" stroke="var(--illus-form)" strokeWidth="1.6" />
    <path d="M30 65h22M41 54v22" stroke="var(--illus-form)" strokeWidth="1.2" />
    <rect x="6" y="50.5" width="48" height="4" rx="1" fill="var(--illus-ink)" opacity="0.26" />
    {/* a panel leaning, waiting to go in */}
    <path d="M58 76 70 34l6 1-6 41Z" fill="var(--illus-form)" stroke="var(--illus-ink)" strokeWidth="1.3" strokeLinejoin="round" opacity="0.9" />
    {/* the ladder */}
    <g stroke="var(--illus-ink)" strokeWidth="1.8" opacity="0.65" fill="none" strokeLinecap="round">
      <path d="M80 76 86 24M92 76 88 24M82 64h9M84 52h7M85 40h6" />
    </g>
  </>
);

/* ── WHAT IS STILL DRAWN, AND WHICH SLOT EACH ONE NOW FILLS (decision 1066) ───────────────────────────────────
   Four slots, two drawings. `Along` is the room receding, which is what both "Slow walkthrough" (Voice-over) and
   "Slow movement" (Only camera) ask for; `Detail` is two planes and a pull, which is "Key detail"; `Material` is
   grain filling the frame, which is "Close-up" — keyed `material`, because `close` is taken by the Face camera
   photograph in `ART` and `ART` wins. `Wide` — the room square on, drawn by 1052 — has no slot left:
   Leon's `room-wide.webp` is that shot, photographed properly. The drawing is kept below rather than deleted
   because the day a real `Slow walkthrough` arrives, this file loses another one and the pattern should be
   readable: a drawing lives here only until the artwork for its slot exists. */
/* ── ONE KEY PER REFERENCE THE LIBRARY ACTUALLY OFFERS (decision 1070) ────────────────────────────────────────
   `FILMING` in `reelprep.js` is the list of references that exist; this is the picture for each one that has no
   photograph yet. WAS HERE AND GONE WITH THEIR SLOTS: `move` and `key` (the old room/detail sets, replaced by
   the library in 1067), `material` (its slot became `closeup`), `closeup` as a DRAWING (artwork since 1070) and
   `wideDrawn` (artwork since 1066). The drawings they used — `Detail`, `Material` and `Wide` — went with them
   rather than sitting here unreferenced: a drawing in this file is a slot's placeholder, and a placeholder for
   a slot that does not exist is just code. */
const DRAWN = {
  walk: { art: Along, alt: 'The room filmed from one end, so its depth reads' },
  pov: { art: Pov, alt: 'The room seen past a phone held up in front of it, filming' },
  beforeafter: { art: BeforeAfter, alt: 'One frame cut in half: the room closed in on the left, opened up on the right' },
  sidebyside: { art: SideBySide, alt: 'Two shots of the same room held up beside each other' },
  progress: { art: Progress, alt: 'The room mid-job: a half-fitted run, a panel waiting, a ladder' },
};

export default function FrameShot({ shot }) {
  const photo = ART[shot];
  if (photo) {
    return (
      <img
        className="ck-shot__pic"
        src={photo.src}
        alt={photo.alt}
        loading="lazy"
        decoding="async"
        width="512"
        height="512"
      />
    );
  }
  const drawn = DRAWN[shot];
  if (!drawn) return null;
  return (
    <svg className="ck-shot__pic" viewBox="0 0 100 100" role="img" aria-label={drawn.alt} focusable="false">
      {drawn.art}
      <Marks />
    </svg>
  );
}
