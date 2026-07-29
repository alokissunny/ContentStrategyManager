import { Link } from 'react-router-dom'
import type { DashboardData } from '../../services/intelligence/repository'
import { Delta, PillarTag } from './bits'

/*
 * What the pillar badge on a hook, topic or hashtag means: the pillar whose
 * top performers use it most distinctively versus the comparison group. It
 * marks where the item is most characteristic, never that it caused anything.
 */
function pillarLead(
  pillar: 'discovery' | 'credibility' | 'trust' | null | undefined,
): string | undefined {
  // Older stored analyses predate the pillar field; skip the tooltip (and, via
  // PillarTag's own guard, the badge) rather than crash on an absent pillar.
  if (!pillar) return undefined
  const label = pillar[0].toUpperCase() + pillar.slice(1)
  return `Used most distinctively by top performers on ${label}, versus the comparison group.`
}

/*
 * Lower research sections for the Competitors overview. Each reports public
 * posting behaviour — how often something is used — never how it performed.
 */

/* ── Hooks ────────────────────────────────────────────────────────────────── */

export function HooksSection({
  hooks,
  limit,
  fullHref,
}: {
  hooks: DashboardData['hooks']
  limit?: number
  fullHref?: string
}) {
  const shown = limit != null ? hooks.slice(0, limit) : hooks
  const hidden = hooks.length - shown.length

  return (
    <section className="panel" aria-labelledby="hooks-title">
      <div className="panel-head panel-head--stacked">
        <h2 id="hooks-title">Most Frequently Used Hooks</h2>
        <p className="panel-subtitle">How often each opener appears — not performance.</p>
      </div>
      {hooks.length === 0 ? (
        <p className="panel-empty">No hook data under the current filters.</p>
      ) : (
        <ol className="hook-list">
          {shown.map((h) => (
            <li className="hook-row" key={h.hookType}>
              <div className="hook-head">
                <span className="hook-name">{h.hookType}</span>
                <span className={`trend trend--${h.trend}`}>
                  {h.trend === 'up'
                    ? '↑ increasing'
                    : h.trend === 'down'
                      ? '↓ decreasing'
                      : '→ stable'}
                </span>
                <span className="hook-rate">{h.useRate}%</span>
              </div>
              <div className="hook-foot">
                <span className="hook-structure">{h.structure}</span>
                <PillarTag pillar={h.pillar} title={pillarLead(h.pillar)} size="sm" />
              </div>
            </li>
          ))}
        </ol>
      )}
      {hidden > 0 && fullHref && (
        <div className="cap-showmore">
          <Link to={fullHref} className="cap-showmore-link">
            View all {hooks.length} hooks →
          </Link>
          <span className="cap-showmore-note">Showing the top {shown.length}</span>
        </div>
      )}
      <p className="panel-foot-note">
        Use rate is the share of analyzed captions opening with this hook. The pillar badge is where
        top performers lean on it hardest versus the comparison group. Structures are abstracted;
        competitor text is never copied.
      </p>
    </section>
  )
}

/* ── Topics ───────────────────────────────────────────────────────────────── */

export function TopicsSection({
  topics,
  limit,
  fullHref,
}: {
  topics: DashboardData['topics']
  limit?: number
  fullHref?: string
}) {
  const rows = topics
  const max = rows.length ? rows[0].sharePct : 1
  const shown = limit != null ? rows.slice(0, limit) : rows
  const hidden = rows.length - shown.length

  return (
    <section className="panel" aria-labelledby="topics-title">
      <div className="panel-head panel-head--stacked">
        <h2 id="topics-title">Topics</h2>
        <p className="panel-subtitle">
          What competitors post about — ranked by share of posts.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="panel-empty">No topic data under the current filters.</p>
      ) : (
        <ol className="topic-list">
          {shown.map((t) => (
            <li className="topic-row" key={t.topic}>
              <div className="topic-main">
                <div className="topic-head">
                  <span className="topic-name">{t.topic}</span>
                  <span className="topic-share">{t.sharePct}%</span>
                </div>
                <div className="topic-bar">
                  <div
                    className="topic-bar-fill topic-bar-fill--instagram"
                    style={{ width: `${Math.round((t.sharePct / max) * 100)}%` }}
                  />
                </div>
                <div className="topic-foot">
                  <span className="topic-meta">
                    {t.accounts} accounts · {t.posts} posts
                  </span>
                  <PillarTag pillar={t.pillar} title={pillarLead(t.pillar)} size="sm" />
                  <Delta value={t.changePp} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {hidden > 0 && fullHref && (
        <div className="cap-showmore">
          <Link to={fullHref} className="cap-showmore-link">
            View all {rows.length} topics →
          </Link>
          <span className="cap-showmore-note">Showing the top {shown.length}</span>
        </div>
      )}
      <p className="panel-foot-note">
        Share of classified competitor posts mentioning the topic within the selected account group.
        The pillar badge is where top performers lean on it hardest versus the comparison group.
      </p>
    </section>
  )
}

/* ── Hashtags ─────────────────────────────────────────────────────────────── */

export function HashtagsSection({
  hashtags,
  basis,
  limit,
  fullHref,
}: {
  hashtags: DashboardData['hashtags']
  basis: DashboardData['hashtagBasis']
  limit?: number
  fullHref?: string
}) {
  const shown = limit != null ? hashtags.slice(0, limit) : hashtags
  const hidden = hashtags.length - shown.length

  return (
    <section className="panel" aria-labelledby="hashtags-title">
      <div className="panel-head panel-head--stacked">
        <h2 id="hashtags-title">Most Frequently Used Hashtags</h2>
        <p className="panel-subtitle">Ranked by how often competitors use them.</p>
      </div>
      {hashtags.length === 0 ? (
        <p className="panel-empty">No hashtag data under the current filters.</p>
      ) : (
        <ol className="hashtag-list">
          {shown.map((h) => {
            const diff = h.highPerformerAccounts - h.comparisonAccounts
            return (
              <li className="hashtag-row" key={h.tag}>
                <div className="hashtag-main">
                  <div className="hashtag-head">
                    <span className="hashtag-tag">{h.tag}</span>
                    <span className={`tag-type tag-type--${h.type.toLowerCase()}`}>{h.type}</span>
                  </div>
                  <div className="hashtag-foot">
                    <span className="hashtag-meta">
                      Used by <strong>{h.highPerformerAccounts} of {basis.highPerformers}</strong> more
                      frequent posters · {h.comparisonAccounts} of {basis.comparison} others
                    </span>
                    <PillarTag pillar={h.pillar} title={pillarLead(h.pillar)} size="sm" />
                  </div>
                </div>
                <span className={`hashtag-diff hashtag-diff--${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}`}>
                  {diff > 0 ? '+' : ''}
                  {diff}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {hidden > 0 && fullHref && (
        <div className="cap-showmore">
          <Link to={fullHref} className="cap-showmore-link">
            View all {hashtags.length} hashtags →
          </Link>
          <span className="cap-showmore-note">Showing the top {shown.length}</span>
        </div>
      )}
      <p className="panel-foot-note">
        Counted from the captions of collected posts. The pillar badge is where top performers lean
        on the tag hardest versus the comparison group. Instagram does not report reach by hashtag
        for other accounts, so this shows who uses a tag — not what it earned them.
      </p>
    </section>
  )
}
