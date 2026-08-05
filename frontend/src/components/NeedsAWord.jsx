/*
 * "Bauhly has a question about these photos" — the one Library group that had a
 * job to do, ported from bauhly-v3 onto the Your Plans page.
 *
 * It surfaces captures the studio saved with photos but no words. Bauhly cannot
 * tell what is in them, so it leaves them out of plans until the studio says.
 * Pressing a row opens the capture (Projects' EntryPanel) to add a line; typing
 * one clears the question and the row drops off. Delete removes the capture.
 *
 * The live app has no "unclear" read-status like the reference store — a
 * wordless capture with media is exactly the same signal, so that is the rule.
 */

import React, { useMemo, useState } from 'react';
import Icon from '../brand/Icon';
import { useProjects, deleteEntry } from '../lib/projectsStore';
import { EntryPanel } from '../pages/Projects';

/* every capture with media and no words, newest first, with its project */
function wordlessCaptures(projects) {
  const out = [];
  (projects || []).forEach((p) => {
    (p.captures || []).forEach((c) => {
      const hasMedia = (c.attachments || []).length > 0;
      if (hasMedia && !String(c.text || '').trim()) out.push({ capture: c, project: p });
    });
  });
  return out.sort((a, b) => String(b.capture.createdAt).localeCompare(String(a.capture.createdAt)));
}

function coverOf(capture) {
  return (capture.attachments || []).find((a) => a.thumbnailUrl || a.url) || null;
}

/* how a wordless capture describes itself — a clip says so, photos say how many */
function fallbackLabel(capture) {
  const atts = capture.attachments || [];
  if (atts.some((a) => a.type === 'video')) return 'A clip, no words yet';
  return `${atts.length} photo${atts.length === 1 ? '' : 's'}, no words yet`;
}

export default function NeedsAWord() {
  const projects = useProjects();
  const items = useMemo(() => wordlessCaptures(projects), [projects]);
  const [open, setOpen] = useState(null); // { project, entry }

  // A section on someone else's page: with nothing to ask, show nothing.
  if (!items.length) return null;

  return (
    <section className="nw">
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
            <li className="nw-row" key={capture.id}>
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
                    <Icon name="plan" size={12} strokeWidth={2} />{project.name}
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
