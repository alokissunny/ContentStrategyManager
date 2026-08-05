/*
 * Visual Brand — the route wrapper.
 *
 * Ported from the reference's BrandProfile: the page head, the tab row, and the
 * Visual Brand body under it. The reference ships two tabs — Visual Style and
 * Layout System — and both are the full thing: Visual Style reads the palette
 * off the studio's pictures and lets them adjust colours, type, backgrounds and
 * logo; Layout System is the sixteen shapes a slide can take, each with a drawn
 * preview. The Overview and Library tabs the container also supports are left
 * off this row exactly as the reference leaves them.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Tabs from '../../components/Tabs.jsx';
import VisualBrand from './VisualBrand.jsx';

const TABS = [
  { id: 'style', label: 'Visual Style', icon: 'swatch' },
  { id: 'layouts', label: 'Layout System', icon: 'plan' },
];

export default function VisualBrandPage() {
  /* arriving from a slide that could not be generated: `?visuals=layout` opens
     Visual Style and focuses the row it is waiting on; `?layouts=hook` opens
     Layout System on that category */
  const [params] = useSearchParams();
  const focus = params.get('visuals');
  const group = params.get('layouts');
  const [tab, setTab] = useState(group ? 'layouts' : 'style');

  return (
    <div className="vb-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Visual Brand</span>
          <h1>How everything Bauhly makes should look.</h1>
          <p className="page-head__sub">
            {({
              style: 'The colours, type, backgrounds and treatment Bauhly applies to everything it makes. Read from your own pictures to begin with — change anything and it stays changed.',
              layouts: 'Bauhly chooses the layout from what the slide has to say, the photographs the project holds and the references in your Visual Brand — so the shape changes and the style does not.',
            })[tab]}
          </p>
        </div>
      </div>

      <Tabs items={TABS} value={tab} onChange={setTab} label="Visual Brand sections" className="bp-tabs tabs--hug" />

      <VisualBrand focus={focus} group={group} tab={tab} />
    </div>
  );
}
