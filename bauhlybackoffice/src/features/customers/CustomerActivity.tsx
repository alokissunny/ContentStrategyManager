import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getCustomerActivity,
  getEditPreview,
  type CaptureLog,
  type EditLog,
  type GeneratedPostLog,
} from '../../services/customers/liveRepository'
import { PostPreview, SlideFrame } from './PostPreview'
import './activity.css'

/*
 * How the selected customer uses Bauhly, for the selected Instagram handle:
 *   Captures        — what they filed, with the Capture conversation
 *   Generated posts — what Bauhly wrote onto their calendar, and what they did
 *                     with each (opened, scheduled, published, edited)
 *   Edits           — the edit log the customer API records per change
 */

type Tab = 'captures' | 'posts' | 'edits'

const CAPTURE_STATUS: Record<CaptureLog['status'], { label: string; tone: string }> = {
  ready: { label: 'Ready for plan', tone: 'ok' },
  'needs-info': { label: 'Needs more information', tone: 'warn' },
  unclear: { label: 'Needs clarification', tone: 'warn' },
  used: { label: 'Used in a plan', tone: 'done' },
  excluded: { label: 'Excluded', tone: 'off' },
}

const ACTION_LABEL: Record<string, string> = {
  edit: 'Edit',
  schedule: 'Schedule',
  publish: 'Publish',
  delete: 'Delete',
  layout: 'Layout',
  'layout-options': 'Layout options',
  theme: 'Theme',
  'theme-region': 'Theme region',
  refine: 'AI refine',
  'add-slide': 'Add slide',
  cover: 'Video cover',
  'polish-caption': 'Polish caption',
  distribute: 'Distribute',
  shift: 'Shift',
  clear: 'Clear',
}

function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function calendarDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  if (!m) return ymd || '—'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`act-chev ${open ? 'is-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CaptureRow({ c }: { c: CaptureLog }) {
  const [open, setOpen] = useState(false)
  const st = CAPTURE_STATUS[c.status]
  const media = [c.photos ? plural(c.photos, 'photo') : '', c.videos ? plural(c.videos, 'clip') : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={`act-row ${open ? 'is-open' : ''}`}>
      <button type="button" className="act-row-hit" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Chevron open={open} />
        <span className="act-when">{when(c.createdAt)}</span>
        <span className="act-main">
          <span className="act-title">{c.title || c.text || (media ? 'Photos with no words' : 'Empty capture')}</span>
          {c.title && c.text && <span className="act-sub">{c.text}</span>}
          <span className="act-meta">
            <span>{c.projectName || 'No project'}</span>
            <span>{c.type}</span>
            {media && <span>{media}</span>}
            {c.turns.length > 0 && <span>{plural(c.turns.length, 'message')}</span>}
            {c.usedInPosts > 0 && <span>{`in ${plural(c.usedInPosts, 'post')}`}</span>}
          </span>
        </span>
        <span className={`act-chip act-chip--${st.tone}`}>{st.label}</span>
      </button>
      {open && (
        <div className="act-detail">
          {(c.questions.length > 0 || c.missingPiece) && (
            <div className="act-block">
              <h4>Open questions</h4>
              <ul className="act-bullets">
                {c.questions.map((q) => <li key={q}>{q}</li>)}
                {c.missingPiece && !c.questions.length && <li>{c.missingPiece}</li>}
              </ul>
            </div>
          )}
          <div className="act-block">
            <h4>Conversation</h4>
            {c.turns.length === 0 ? (
              <p className="act-empty">
                No conversation on file{c.text ? ' — the note was:' : '.'}
                {c.text && <span className="act-note">{c.text}</span>}
              </p>
            ) : (
              <ol className="act-thread">
                {c.turns.map((t, i) => (
                  <li key={i} className={`act-turn act-turn--${t.role === 'assistant' ? 'bauhly' : 'user'}`}>
                    <span className="act-turn-who">{t.role === 'assistant' ? 'Bauhly' : 'Customer'}</span>
                    <span className="act-turn-say">{t.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {c.usedInPlanAt && (
            <p className="act-foot">Plan generated from it {when(c.usedInPlanAt)}</p>
          )}
        </div>
      )}
    </li>
  )
}

function PostRow({
  p,
  onEdits,
  customerId,
  includeAdmins,
}: {
  p: GeneratedPostLog
  onEdits: (id: string) => void
  customerId: string
  includeAdmins: boolean
}) {
  const [open, setOpen] = useState(false)
  const pillar = (p.pillar || 'discovery').toLowerCase()
  return (
    <li className={`act-row ${open ? 'is-open' : ''}`}>
      <button type="button" className="act-row-hit" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Chevron open={open} />
        <span className="act-when">
          {calendarDay(p.date)}
          <span className="act-when-sub">made {when(p.generatedAt)}</span>
        </span>
        <span className="act-main">
          <span className="act-title">{p.title || 'Untitled post'}</span>
          <span className="act-meta">
            <span className={`pillar-tag pillar-tag--${pillar}`}>{pillar}</span>
            <span>{p.format}</span>
            {p.slides.length > 0 && <span>{plural(p.slides.length, 'slide')}</span>}
          </span>
        </span>
        <span className="act-states">
          <span className={`act-chip act-chip--${p.seenAt ? 'ok' : 'off'}`}>{p.seenAt ? 'Opened' : 'Not opened'}</span>
          {p.edits > 0 && <span className="act-chip act-chip--info">{plural(p.edits, 'edit')}</span>}
          {p.savedForReview && <span className="act-chip act-chip--warn">For review</span>}
          {p.scheduledAt && !p.published && <span className="act-chip act-chip--info">Scheduled</span>}
          {p.published && <span className="act-chip act-chip--done">Published</span>}
        </span>
      </button>
      {open && (
        <div className="act-detail act-post-body">
          <PostPreview customerId={customerId} postId={p.id} includeAdmins={includeAdmins} />
          <div className="act-post-info">
          {p.slides.length > 0 && (
            <div className="act-block">
              <h4>Slides</h4>
              <ol className="act-slides">
                {p.slides.map((s, i) => (
                  <li key={i}>
                    {s.role && <span className="act-slide-role">{s.role}</span>}
                    {s.title || '—'}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {p.caption && (
            <div className="act-block">
              <h4>Caption</h4>
              <p className="act-note">{p.caption}</p>
              {p.hashtags.length > 0 && <p className="act-tags">{p.hashtags.join(' ')}</p>}
            </div>
          )}
          <dl className="act-facts">
            <div><dt>Opened</dt><dd>{when(p.seenAt)}</dd></div>
            <div><dt>Scheduled for</dt><dd>{when(p.scheduledAt)}</dd></div>
            <div><dt>Last edited</dt><dd>{when(p.lastEditedAt)}</dd></div>
            <div><dt>Model</dt><dd>{p.model || '—'}</dd></div>
            <div><dt>Cost</dt><dd>{p.costUsd ? `$${p.costUsd.toFixed(3)}` : '—'}</dd></div>
          </dl>
          {p.edits > 0 && (
            <button type="button" className="btn-secondary act-jump" onClick={() => onEdits(p.id)}>
              See its {plural(p.edits, 'edit')}
            </button>
          )}
          </div>
        </div>
      )}
    </li>
  )
}

// changes that live on a slide of the carousel document — drawn as previews
const SLIDE_FIELD = /^(Slide \d+ · |Slides$|Design$)/

function EditChanges({ e, customerId, includeAdmins }: { e: EditLog; customerId: string; includeAdmins: boolean }) {
  const pv = useQuery({
    queryKey: ['edit-preview', customerId, e.id, includeAdmins],
    queryFn: () => getEditPreview(customerId, e.id, { includeAdmins }),
    enabled: e.hasPreview,
    staleTime: 60_000,
  })
  const p = e.hasPreview ? pv.data : null
  // with previews, slide changes are shown as the slides themselves
  const textRows = p?.changed.length ? e.changes.filter((c) => !SLIDE_FIELD.test(c.field)) : e.changes

  return (
    <>
      {e.hasPreview && pv.isPending && <p className="act-empty">Loading slide previews…</p>}
      {p && p.changed.length > 0 && (
        <table className="act-changes act-changes--slides">
          <thead>
            <tr><th>Slide</th><th>Before</th><th>After</th></tr>
          </thead>
          <tbody>
            {p.changed.map((i) => (
              <tr key={i}>
                <td className="act-field">{`Slide ${i + 1}`}</td>
                <td>
                  {p.before && (p.before.match(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b/gi) || []).length > i
                    ? <SlideFrame html={p.before} index={i} height={p.height} width={240} title={`Slide ${i + 1} before`} />
                    : <span className="act-none">Not there yet</span>}
                </td>
                <td>
                  {p.after && (p.after.match(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b/gi) || []).length > i
                    ? <SlideFrame html={p.after} index={i} height={p.height} width={240} title={`Slide ${i + 1} after`} />
                    : <span className="act-none">Removed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {textRows.length > 0 && (
        <table className="act-changes">
          <thead>
            <tr><th>What</th><th>Before</th><th>After</th></tr>
          </thead>
          <tbody>
            {textRows.map((c, i) => (
              <tr key={`${c.field}-${i}`}>
                <td className="act-field">{c.field}</td>
                <td className="act-before">{c.before || <span className="act-none">—</span>}</td>
                <td className="act-after">{c.after || <span className="act-none">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function EditRow({ e, customerId, includeAdmins }: { e: EditLog; customerId: string; includeAdmins: boolean }) {
  const [open, setOpen] = useState(false)
  const canOpen = e.changes.length > 0 || e.hasPreview
  return (
    <li className={`act-row ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="act-row-hit"
        onClick={() => canOpen && setOpen(!open)}
        aria-expanded={canOpen ? open : undefined}
        disabled={!canOpen}
      >
        {canOpen ? <Chevron open={open} /> : <span className="act-chev" />}
        <span className="act-when">{when(e.at)}</span>
        <span className="act-main">
          <span className="act-title">{e.label || ACTION_LABEL[e.action] || e.action}</span>
          <span className="act-meta">
            {e.postId ? (
              <span>{`${e.postTitle || 'Untitled post'}${e.postDate ? ` · ${calendarDay(e.postDate)}` : ''}`}</span>
            ) : (
              <span>Whole calendar</span>
            )}
            {e.count > 1 && <span>{`${e.count} saves since ${when(e.firstAt)}`}</span>}
          </span>
        </span>
        <span className="act-chip act-chip--info">{ACTION_LABEL[e.action] || e.action}</span>
      </button>
      {open && (
        <div className="act-detail">
          <EditChanges e={e} customerId={customerId} includeAdmins={includeAdmins} />
        </div>
      )}
    </li>
  )
}

export function CustomerActivityPanel({
  customerId,
  handle,
  includeAdmins,
}: {
  customerId: string
  handle: string | null
  includeAdmins: boolean
}) {
  const [tab, setTab] = useState<Tab>('captures')
  const [postFilter, setPostFilter] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['customer-activity', customerId, handle, includeAdmins],
    queryFn: () => getCustomerActivity(customerId, { handle, includeAdmins }),
  })

  const data = q.data
  const posts = data?.posts ?? []
  const edits = (data?.edits ?? []).filter((e) => !postFilter || e.postId === postFilter)
  const filteredPost = postFilter ? posts.find((p) => p.id === postFilter) : null

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'captures', label: 'Capture logs', n: data?.totals.captures ?? 0 },
    { id: 'posts', label: 'Generated posts', n: data?.totals.posts ?? 0 },
    { id: 'edits', label: 'Edit logs', n: data?.totals.edits ?? 0 },
  ]

  const opened = posts.filter((p) => p.seenAt).length
  const edited = posts.filter((p) => p.edits > 0).length
  const scheduled = posts.filter((p) => p.scheduledAt && !p.published).length
  const published = posts.filter((p) => p.published).length

  return (
    <section className="weekly-plan act" aria-labelledby={`act-title-${customerId}`}>
      <div className="panel-head weekly-plan-head">
        <h2 id={`act-title-${customerId}`}>Activity{handle ? ` · @${handle}` : ''}</h2>
      </div>

      {q.isPending ? (
        <p className="section-note">Loading activity…</p>
      ) : q.isError ? (
        <p className="section-note">
          Couldn’t load activity.{' '}
          <button type="button" className="btn-secondary" onClick={() => q.refetch()}>Retry</button>
        </p>
      ) : !data ? (
        <p className="section-note">No activity found for this customer.</p>
      ) : (
        <>
          <div className="act-summary">
            <div><b>{data.totals.captures}</b><span>captures</span></div>
            <div><b>{data.totals.posts}</b><span>posts generated</span></div>
            <div><b>{opened}</b><span>opened</span></div>
            <div><b>{edited}</b><span>edited</span></div>
            <div><b>{scheduled}</b><span>scheduled</span></div>
            <div><b>{published}</b><span>published</span></div>
          </div>

          <div className="act-tabs" role="tablist" aria-label="Activity">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`act-tab ${tab === t.id ? 'is-on' : ''}`}
                onClick={() => { setTab(t.id); if (t.id !== 'edits') setPostFilter(null) }}
              >
                {t.label}
                <span className="act-tab-n">{t.n}</span>
              </button>
            ))}
          </div>

          {tab === 'captures' && (
            data.captures.length === 0
              ? <p className="act-empty">No captures yet.</p>
              : <ul className="act-list">{data.captures.map((c) => <CaptureRow key={c.id} c={c} />)}</ul>
          )}

          {tab === 'posts' && (
            posts.length === 0
              ? <p className="act-empty">No posts generated yet.</p>
              : (
                <ul className="act-list">
                  {posts.map((p) => (
                    <PostRow
                      key={p.id}
                      p={p}
                      customerId={customerId}
                      includeAdmins={includeAdmins}
                      onEdits={(id) => { setPostFilter(id); setTab('edits') }}
                    />
                  ))}
                </ul>
              )
          )}

          {tab === 'edits' && (
            <>
              {postFilter && (
                <p className="act-filter">
                  Showing edits to <b>{filteredPost?.title || 'one post'}</b>
                  <button type="button" className="act-link" onClick={() => setPostFilter(null)}>Show all</button>
                </p>
              )}
              {edits.length === 0 ? (
                <p className="act-empty">
                  No edits recorded yet. Edits are logged from the day this feature shipped; older changes were not kept.
                </p>
              ) : (
                <ul className="act-list">{edits.map((e) => <EditRow key={e.id} e={e} customerId={customerId} includeAdmins={includeAdmins} />)}</ul>
              )}
            </>
          )}

          {(data.totals.posts > posts.length || data.totals.edits > (data.edits?.length ?? 0)) && (
            <p className="act-foot">Showing the most recent 200 of each.</p>
          )}
        </>
      )}
    </section>
  )
}
