/*
 * "Bauhly has a question about these photos" — surfaces captures the studio
 * saved with photos/clips but no words. Bauhly cannot tell what is in them, so
 * it leaves them out of plans until the studio adds a line. Pressing a row
 * opens the capture (Projects' EntryPanel); typing one line clears the question.
 * Delete removes the capture.
 */

import React, { useMemo, useState } from 'react';
import Icon from '../brand/Icon';
import { useProjects, useProjectsHydrated, deleteEntry } from '../lib/projectsStore';
import { EntryPanel } from '../pages/Projects';

/* Media with no usable note — empty / whitespace-only text. */
function isWordless(capture) {
  const atts = capture?.attachments || [];
  const hasMedia = atts.some((a) => a && (a.type === 'image' || a.type === 'video' || a.url || a.key));
  if (!hasMedia) return false;
  return !String(capture.text || '').trim();
}

function wordlessCaptures(projects) {
  const out = [];
  (projects || []).forEach((p) => {
    (p.captures || []).forEach((c) => {
      if (isWordless(c)) out.push({ capture: c, project: p });
    });
  });
  return out.sort((a, b) => String(b.capture.createdAt || '').localeCompare(String(a.capture.createdAt || '')));
}

function coverOf(capture) {
  return (capture.attachments || []).find((a) => a.thumbnailUrl || a.url) || null;
}

function fallbackLabel(capture) {
  const atts = capture.attachments || [];
  if (atts.some((a) => a.type === 'video')) return 'A clip, no words yet';
  const n = atts.length || 1;
  return `${n} photo${n === 1 ? '' : 's'}, no words yet`;
}

export default function NeedsAWord() {
  const projects = useProjects();
  const hydrated = useProjectsHydrated();
  const items = useMemo(() => wordlessCaptures(projects), [projects]);
  const [open, setOpen] = useState(null); // { project, entry }

  // Wait for the first projects fetch so we don't flash an empty section, then
  // hide entirely when there is nothing to ask.
  if (!hydrated || !items.length) return null;

  return (
    <section className="nw" aria-label="Photos that need a note">
      <div className="nw__head">
        <h2 className="nw__title">
          Bauhly has a question about these photos
          <span className="nw__count">{items.length}</span>
        </h2>
        <p className="nw__lead">
          It cannot tell what is in them, so it will leave them out of your plans until you
          say. One short line each is plenty — “the kitchen, half finished” is enough.
        </p>
      </div>

      <ul className="nw__list">
        {items.map(({ capture, project }) => {
          const cover = coverOf(capture);
          const shots = (capture.attachments || []).length;
          return (
            <li className="nw-row" key={capture.id || `${project.id}-${capture.createdAt}`}>
              <button
                type="button"
                className="nw-row__hit"
                onClick={() => setOpen({ project, entry: capture })}
                aria-label={fallbackLabel(capture)}
              >
                <span className="nw-row__thumb">
                  {cover
                    ? <img src={cover.thumbnailUrl || cover.url} alt="" loading="lazy" />
                    : <Icon name="image" size={17} strokeWidth={2} />}
                  {shots > 1 && <b className="nw-row__count">{shots}</b>}
                </span>
                <span className="nw-row__body">
                  <span className="nw-row__text">{fallbackLabel(capture)}</span>
                  <span className="nw-row__meta">
                    <Icon name="plan" size={12} strokeWidth={2} />
                    {project.name}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="nw-row__del"
                onClick={() => deleteEntry(project.id, capture.id)}
                aria-label="Delete this capture"
                title="Delete this capture"
              >
                <Icon name="trash" size={16} strokeWidth={2} />
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <EntryPanel
          project={open.project}
          entry={open.entry}
          week={open.project.name}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
