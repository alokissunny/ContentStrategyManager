/*
 * AnalysisOverviewBody — sections for the Bauhly "Your analysis" modal:
 * verdict hero, account summary, strengths, opportunities, similar accounts
 * (when a cohort is assigned), strategic focus, how this shapes your week.
 */

import React from 'react';
import Icon from '../brand/Icon';
import './analysisOverview.css';

function Sec({ label, children }) {
  return (
    <section className="an__sec">
      {label && <span className="fmodal__label">{label}</span>}
      {children}
    </section>
  );
}

function Verdict({ verdict }) {
  if (!verdict) return null;
  const { clauses = [], proof, rows = [] } = verdict;
  const dir = proof?.dir === 'ahead' ? 'ahead' : proof?.dir === 'behind' ? 'behind' : '';

  return (
    <section className="an__sec">
      <div className="an-verdict">
        <p className="an-verdict__head">
          {clauses.map((c) => (
            <span key={c} className="an-verdict__clause">{c}{' '}</span>
          ))}
        </p>

        {proof && (
          <div className={`an-proof ${dir ? `is-${dir}` : ''}${proof.solo ? ' is-solo' : ''}`}>
            <span className="an-proof__metric">{proof.metric}</span>
            <div className="an-proof__pair">
              <div className="an-proof__side is-mine">
                <span className="an-proof__who">{proof.youLabel || 'You'}</span>
                <span className="an-proof__num">{proof.you?.display}</span>
                <span className="an-proof__bar" aria-hidden="true">
                  <i style={{ width: `${Math.round((proof.you?.bar || 0) * 100)}%` }} />
                </span>
              </div>
              {proof.peer && (
                <div className="an-proof__side">
                  <span className="an-proof__who">{proof.peerLabel || 'Similar studios'}</span>
                  <span className="an-proof__num">{proof.peer?.display}</span>
                  <span className="an-proof__bar" aria-hidden="true">
                    <i style={{ width: `${Math.round((proof.peer?.bar || 0) * 100)}%` }} />
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <dl className="an-verdict__rows">
            {rows.map((r) => (
              <div key={r.label} className={`an-verdict__row is-${r.kind}`}>
                <dt>{r.label}</dt>
                <dd>{r.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

function SimilarAccounts({ similar }) {
  if (!similar) return null;
  const { basis, insight, comparison } = similar;

  return (
    <Sec label="Similar accounts">
      {basis && (
        <div className="an__basis">
          <Icon name="evidence" size={14} strokeWidth={1.8} />
          <span>
            {basis.split(/(\d[\d,]* similar studios)/).map((part, i) => (
              /\d[\d,]* similar studios/.test(part)
                ? <b key={i}>{part}</b>
                : <React.Fragment key={i}>{part}</React.Fragment>
            ))}
          </span>
        </div>
      )}
      {insight && <p className="fmodal__body">{insight}</p>}
      {!insight && !comparison && (
        <p className="fmodal__body">Cohort is assigned. A detailed finding will appear here once the competitor analysis includes comparable metrics.</p>
      )}
      {comparison && (
        <div className="an__cmp">
          <div className="an__cmp-metric">{comparison.metric}</div>
          <div className="an__cmp-row">
            <span className="an__cmp-who">{comparison.youLabel || 'You'}</span>
            <span className="an__cmp-num">{comparison.you}</span>
          </div>
          <div className="an__cmp-row">
            <span className="an__cmp-who">{comparison.peerLabel || 'Similar studios'}</span>
            <span className="an__cmp-num an__cmp-num--peer">{comparison.peer}</span>
          </div>
          {comparison.footing && <div className="an__cmp-basis">{comparison.footing}</div>}
        </div>
      )}
    </Sec>
  );
}

export default function AnalysisOverviewBody({ data }) {
  if (!data) return null;
  const focus = data.strategicFocus;

  return (
    <>
      <span className="an-modal__eyebrow">Your analysis</span>
      <h2 className="an-modal__title">{data.headline || "Here's what Bauhly found in your account."}</h2>

      <Verdict verdict={data.verdict} />

      {data.accountSummary && (
        <Sec label="Account summary">
          <p className="fmodal__body">{data.accountSummary}</p>
        </Sec>
      )}

      {data.strengths?.length > 0 && (
        <Sec label="Strengths">
          <ul className="an__list an__list--good">
            {data.strengths.map((s) => (
              <li key={s}>
                <Icon name="check" size={16} strokeWidth={2.2} />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      {data.opportunities?.length > 0 && (
        <Sec label="Biggest opportunities">
          <ul className="an__list an__list--gap">
            {data.opportunities.map((o) => (
              <li key={o}>
                <Icon name="arrow-right" size={16} strokeWidth={2.2} />
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      <SimilarAccounts similar={data.similarAccounts} />

      {focus && (
        <Sec label="Strategic focus">
          <div className={`an__focus is-${focus.pillar || 'trust'}`}>
            <span className="an__focus-ico">
              <Icon name={focus.icon || 'trust'} size={18} strokeWidth={1.8} />
            </span>
            <span className="an__focus-text">
              <b>{focus.label}</b>
              <span>{focus.tagline}</span>
            </span>
          </div>
          {focus.explanation && <p className="fmodal__body">{focus.explanation}</p>}
        </Sec>
      )}

      {data.shapesWeek && (
        <Sec label="How this shapes your week">
          <p className="fmodal__body">{data.shapesWeek}</p>
        </Sec>
      )}
    </>
  );
}
