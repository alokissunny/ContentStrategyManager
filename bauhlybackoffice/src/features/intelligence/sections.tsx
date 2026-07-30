import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardData } from '../../services/intelligence/repository'
import type {
  HashtagRow,
  HookPerformanceRow,
  TopicRow,
} from '../../services/intelligence/mockData'
import { ClockIcon, PostsIcon, TrendUpIcon, ZapIcon } from '../../components/icons'
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

type ExampleCaption = { competitor: string; caption: string }

function PostExamples({ examples }: { examples: ExampleCaption[] }) {
  return (
    <div className="hook-evidence-examples">
      <h4>
        Post examples <span className="cap-detail-h4-note">from the analyzed dataset</span>
      </h4>
      {examples.length === 0 ? (
        <p className="cap-example-empty">
          No matching captions have been surfaced yet. Re-run analysis to collect examples from
          classified posts.
        </p>
      ) : (
        <ul className="hook-example-list">
          {examples.map((ex, i) => (
            <li key={`${ex.competitor}-${i}`}>
              <figure className="cap-example">
                <blockquote className="cap-example-caption">{ex.caption}</blockquote>
                <figcaption className="cap-example-credit">
                  <span className="cap-example-avatar" aria-hidden="true">
                    {ex.competitor.slice(0, 1)}
                  </span>
                  <span className="cap-example-name">{ex.competitor}</span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EvidenceMetrics({
  items,
}: {
  items: { icon: ReactNode; num: ReactNode; lbl: string; tone?: string }[]
}) {
  return (
    <ul className="hook-evidence-list">
      {items.map((item, i) => (
        <li
          key={i}
          className={`cap-evidence-item${item.tone ? ' cap-evidence-item--trend' : ''}`}
        >
          {item.icon}
          <div className="cap-evidence-text">
            <span className={`cap-evidence-num${item.tone ? ` cap-trend--${item.tone}` : ''}`}>
              {item.num}
            </span>
            <span className="cap-evidence-lbl">{item.lbl}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/*
 * Lower research sections for the Competitors overview. Each reports public
 * posting behaviour — how often something is used — never how it performed.
 */

/* ── Hooks ────────────────────────────────────────────────────────────────── */

function HookEvidence({ hook }: { hook: HookPerformanceRow }) {
  const trendLabel =
    hook.trend === 'up' ? 'Increasing' : hook.trend === 'down' ? 'Decreasing' : 'Stable'
  const trendTone = hook.trend === 'up' ? 'up' : hook.trend === 'down' ? 'down' : 'flat'

  return (
    <div className="hook-evidence">
      <span className="cap-evidence-title">Supporting evidence</span>
      <EvidenceMetrics
        items={[
          {
            icon: <PostsIcon className="cap-evidence-icon" />,
            num: `${hook.useRate}%`,
            lbl: 'of analyzed captions',
          },
          {
            icon: <ZapIcon className="cap-evidence-icon" />,
            num: `${hook.medianEngagement}%`,
            lbl: 'median public ER',
          },
          {
            icon: <TrendUpIcon className="cap-evidence-icon" />,
            num: trendLabel,
            lbl: 'frequency trend',
            tone: trendTone,
          },
          {
            icon: <ClockIcon className="cap-evidence-icon" />,
            num: hook.pillar
              ? hook.pillar.charAt(0).toUpperCase() + hook.pillar.slice(1)
              : '—',
            lbl: 'authority pillar',
          },
        ]}
      />
      {hook.structure ? (
        <div className="hook-evidence-structure">
          <h4>Typical opener</h4>
          <p>{hook.structure}</p>
        </div>
      ) : null}
      <PostExamples examples={hook.exampleCaptions ?? []} />
    </div>
  )
}

function HookRow({
  hook,
  open,
  onToggle,
}: {
  hook: HookPerformanceRow
  open: boolean
  onToggle: () => void
}) {
  return (
    <li className={`hook-row${open ? ' hook-row--open' : ''}`}>
      <button type="button" className="hook-row-toggle" aria-expanded={open} onClick={onToggle}>
        <div className="hook-head">
          <span className="hook-name">{hook.hookType}</span>
          <span className={`trend trend--${hook.trend}`}>
            {hook.trend === 'up'
              ? '↑ increasing'
              : hook.trend === 'down'
                ? '↓ decreasing'
                : '→ stable'}
          </span>
          <span className="hook-rate">{hook.useRate}%</span>
          <span className={`cap-chevron${open ? ' cap-chevron--open' : ''}`} aria-hidden="true" />
        </div>
        <div className="hook-foot">
          <span className="hook-structure">{hook.structure}</span>
          <PillarTag pillar={hook.pillar} title={pillarLead(hook.pillar)} size="sm" />
        </div>
      </button>
      {open ? <HookEvidence hook={hook} /> : null}
    </li>
  )
}

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
  const [openType, setOpenType] = useState<string | null>(null)

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
            <HookRow
              key={h.hookType}
              hook={h}
              open={openType === h.hookType}
              onToggle={() => setOpenType((cur) => (cur === h.hookType ? null : h.hookType))}
            />
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
        competitor text is never copied. Click a row for supporting evidence.
      </p>
    </section>
  )
}

/* ── Topics ───────────────────────────────────────────────────────────────── */

function TopicEvidence({ topic }: { topic: TopicRow }) {
  const changeTone = topic.changePp > 0 ? 'up' : topic.changePp < 0 ? 'down' : 'flat'
  const changeLabel =
    topic.changePp > 0
      ? `+${topic.changePp}pp`
      : topic.changePp < 0
        ? `${topic.changePp}pp`
        : '0pp'

  return (
    <div className="hook-evidence">
      <span className="cap-evidence-title">Supporting evidence</span>
      <EvidenceMetrics
        items={[
          {
            icon: <PostsIcon className="cap-evidence-icon" />,
            num: `${topic.sharePct}%`,
            lbl: 'share of posts',
          },
          {
            icon: <ZapIcon className="cap-evidence-icon" />,
            num: topic.posts.toLocaleString('en-US'),
            lbl: 'matching posts',
          },
          {
            icon: <TrendUpIcon className="cap-evidence-icon" />,
            num: changeLabel,
            lbl: 'vs prior window',
            tone: changeTone,
          },
          {
            icon: <ClockIcon className="cap-evidence-icon" />,
            num: topic.pillar
              ? topic.pillar.charAt(0).toUpperCase() + topic.pillar.slice(1)
              : '—',
            lbl: 'authority pillar',
          },
        ]}
      />
      <div className="hook-evidence-structure">
        <h4>Coverage</h4>
        <p>
          {topic.accounts} account{topic.accounts === 1 ? '' : 's'} ·{' '}
          {topic.posts.toLocaleString('en-US')} post{topic.posts === 1 ? '' : 's'} in the analyzed
          set.
        </p>
      </div>
      <PostExamples examples={topic.exampleCaptions ?? []} />
    </div>
  )
}

function TopicRowItem({
  topic,
  max,
  open,
  onToggle,
}: {
  topic: TopicRow
  max: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <li className={`topic-row${open ? ' topic-row--open' : ''}`}>
      <button type="button" className="hook-row-toggle" aria-expanded={open} onClick={onToggle}>
        <div className="topic-main">
          <div className="topic-head">
            <span className="topic-name">{topic.topic}</span>
            <span className="topic-share">{topic.sharePct}%</span>
            <span className={`cap-chevron${open ? ' cap-chevron--open' : ''}`} aria-hidden="true" />
          </div>
          <div className="topic-bar">
            <div
              className="topic-bar-fill topic-bar-fill--instagram"
              style={{ width: `${Math.round((topic.sharePct / max) * 100)}%` }}
            />
          </div>
          <div className="topic-foot">
            <span className="topic-meta">
              {topic.accounts} accounts · {topic.posts} posts
            </span>
            <PillarTag pillar={topic.pillar} title={pillarLead(topic.pillar)} size="sm" />
            <Delta value={topic.changePp} />
          </div>
        </div>
      </button>
      {open ? <TopicEvidence topic={topic} /> : null}
    </li>
  )
}

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
  const [openTopic, setOpenTopic] = useState<string | null>(null)

  return (
    <section className="panel" aria-labelledby="topics-title">
      <div className="panel-head panel-head--stacked">
        <h2 id="topics-title">Topics</h2>
        <p className="panel-subtitle">What competitors post about — ranked by share of posts.</p>
      </div>

      {rows.length === 0 ? (
        <p className="panel-empty">No topic data under the current filters.</p>
      ) : (
        <ol className="topic-list">
          {shown.map((t) => (
            <TopicRowItem
              key={t.topic}
              topic={t}
              max={max || 1}
              open={openTopic === t.topic}
              onToggle={() => setOpenTopic((cur) => (cur === t.topic ? null : t.topic))}
            />
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
        Click a row for supporting evidence.
      </p>
    </section>
  )
}

/* ── Hashtags ─────────────────────────────────────────────────────────────── */

function HashtagEvidence({
  hashtag,
  basis,
}: {
  hashtag: HashtagRow
  basis: DashboardData['hashtagBasis']
}) {
  const diff = hashtag.highPerformerAccounts - hashtag.comparisonAccounts
  const diffTone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
  const diffLabel = `${diff > 0 ? '+' : ''}${diff}`

  return (
    <div className="hook-evidence">
      <span className="cap-evidence-title">Supporting evidence</span>
      <EvidenceMetrics
        items={[
          {
            icon: <ZapIcon className="cap-evidence-icon" />,
            num: `${hashtag.highPerformerAccounts} / ${basis.highPerformers}`,
            lbl: 'more frequent posters',
          },
          {
            icon: <PostsIcon className="cap-evidence-icon" />,
            num: `${hashtag.comparisonAccounts} / ${basis.comparison}`,
            lbl: 'other accounts',
          },
          {
            icon: <TrendUpIcon className="cap-evidence-icon" />,
            num: diffLabel,
            lbl: 'usage gap',
            tone: diffTone,
          },
          {
            icon: <ClockIcon className="cap-evidence-icon" />,
            num: hashtag.pillar
              ? hashtag.pillar.charAt(0).toUpperCase() + hashtag.pillar.slice(1)
              : '—',
            lbl: 'authority pillar',
          },
        ]}
      />
      <div className="hook-evidence-structure">
        <h4>Tag type</h4>
        <p>{hashtag.type} hashtag — counted from captions of collected posts, not reach.</p>
      </div>
      <PostExamples examples={hashtag.exampleCaptions ?? []} />
    </div>
  )
}

function HashtagRowItem({
  hashtag,
  basis,
  open,
  onToggle,
}: {
  hashtag: HashtagRow
  basis: DashboardData['hashtagBasis']
  open: boolean
  onToggle: () => void
}) {
  const diff = hashtag.highPerformerAccounts - hashtag.comparisonAccounts
  return (
    <li className={`hashtag-row${open ? ' hashtag-row--open' : ''}`}>
      <button
        type="button"
        className="hook-row-toggle hashtag-row-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <div className="hashtag-main">
          <div className="hashtag-head">
            <span className="hashtag-tag">{hashtag.tag}</span>
            <span className={`tag-type tag-type--${hashtag.type.toLowerCase()}`}>{hashtag.type}</span>
          </div>
          <div className="hashtag-foot">
            <span className="hashtag-meta">
              Used by <strong>
                {hashtag.highPerformerAccounts} of {basis.highPerformers}
              </strong>{' '}
              more frequent posters · {hashtag.comparisonAccounts} of {basis.comparison} others
            </span>
            <PillarTag pillar={hashtag.pillar} title={pillarLead(hashtag.pillar)} size="sm" />
          </div>
        </div>
        <span className={`hashtag-diff hashtag-diff--${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}`}>
          {diff > 0 ? '+' : ''}
          {diff}
        </span>
        <span className={`cap-chevron${open ? ' cap-chevron--open' : ''}`} aria-hidden="true" />
      </button>
      {open ? <HashtagEvidence hashtag={hashtag} basis={basis} /> : null}
    </li>
  )
}

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
  const [openTag, setOpenTag] = useState<string | null>(null)

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
          {shown.map((h) => (
            <HashtagRowItem
              key={h.tag}
              hashtag={h}
              basis={basis}
              open={openTag === h.tag}
              onToggle={() => setOpenTag((cur) => (cur === h.tag ? null : h.tag))}
            />
          ))}
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
        for other accounts, so this shows who uses a tag — not what it earned them. Click a row for
        supporting evidence.
      </p>
    </section>
  )
}
