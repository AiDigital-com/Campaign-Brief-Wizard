/**
 * RenderedBrief — the 13-section media brief, conditionally rendered.
 *
 * Hard rule: NEVER render placeholder copy for missing data. If a field is
 * missing, the JSX simply doesn't emit anything for it. The eyebrow chip on
 * each h2 (`{count} pending`, "missing", etc.) is the only acknowledgement
 * of incompleteness.
 *
 * Section keys mirror BRIEF_SECTION_KEYS in src/lib/types.ts so the Updated
 * overlay (slice 8) can highlight by adding `is-updated` to the relevant h2.
 */
import type {
  Brief,
  BriefBudget,
  BriefChannels,
  BriefGoals,
  BriefMeasurement,
  BriefSectionKey,
  BriefSubmission,
  BriefAudience,
  BriefCreative,
} from '../lib/types';

interface Props {
  brief: Brief;
  showUpdates?: boolean;
  changedSections?: BriefSectionKey[];
}

const ORDINAL: Record<BriefSectionKey, string> = {
  submission: '01', background: '02', goals: '03', kpis: '04',
  audience: '05', competitors: '06', geos: '07', budget: '08',
  channels: '09', creative: '10', measurement: '11', deliverables: '12',
  openQuestions: '13',
};

const TITLE: Record<BriefSectionKey, string> = {
  submission: 'Submission',
  background: 'Business & marketing background',
  goals: 'Goals & objectives',
  kpis: 'Success metrics & benchmarks',
  audience: 'Audience & personas',
  competitors: 'Competitive set',
  geos: 'Geo & markets',
  budget: 'Budget & flighting',
  channels: 'Channels & tactics',
  creative: 'Creative & messaging',
  measurement: 'Measurement & ops',
  deliverables: 'Deliverables',
  openQuestions: 'Open questions',
};

export function RenderedBrief({ brief, showUpdates, changedSections = [] }: Props) {
  const isUpdated = (k: BriefSectionKey) => Boolean(showUpdates) && changedSections.includes(k);

  return (
    <div className={`cbw-doc${showUpdates ? ' show-updates' : ''}`}>
      <DocHeader brief={brief} updatedCount={showUpdates ? changedSections.length : 0} />

      {hasSubmission(brief.submission) && (
        <SectionShell k="submission" updated={isUpdated('submission')} src="client intake">
          <Submission s={brief.submission!} />
        </SectionShell>
      )}

      {brief.background && (
        <SectionShell k="background" updated={isUpdated('background')}>
          <p>{brief.background}</p>
        </SectionShell>
      )}

      {hasGoals(brief.goals) && (
        <SectionShell k="goals" updated={isUpdated('goals')}>
          <Goals g={brief.goals!} />
        </SectionShell>
      )}

      {brief.kpis && brief.kpis.length > 0 && (
        <SectionShell k="kpis" updated={isUpdated('kpis')}>
          <div className="cbw-doc__kpis">
            {brief.kpis.map((kpi, i) => (
              <div className="cbw-kpi" key={i}>
                <div className="cbw-kpi__label">{kpi.label}</div>
                <div className="cbw-kpi__row">
                  {kpi.base && <span className="cbw-kpi__base">{kpi.base}</span>}
                  {kpi.base && <span className="cbw-kpi__arrow">→</span>}
                  <span className="cbw-kpi__target">{kpi.target}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionShell>
      )}

      {hasAudience(brief.audience) && (
        <SectionShell k="audience" updated={isUpdated('audience')}>
          <Audience a={brief.audience!} />
        </SectionShell>
      )}

      {brief.competitors && brief.competitors.length > 0 && (
        <SectionShell k="competitors" updated={isUpdated('competitors')}>
          <div className="cbw-comp-list">
            {brief.competitors.map((c, i) => (
              <span className="cbw-comp" key={i}>{c}</span>
            ))}
          </div>
        </SectionShell>
      )}

      {brief.geos && brief.geos.length > 0 && (
        <SectionShell k="geos" updated={isUpdated('geos')}>
          <div className="cbw-geo-grid">
            {brief.geos.map((g, i) => (
              <div className={`cbw-geo${g.primary ? ' is-primary' : ''}`} key={i}>
                <span className="cbw-geo__pin">📍</span>
                <div>
                  <div className="cbw-geo__city">{g.city}</div>
                  {g.market && <div className="cbw-geo__market">{g.market}</div>}
                </div>
              </div>
            ))}
          </div>
        </SectionShell>
      )}

      {hasBudget(brief.budget) && (
        <SectionShell k="budget" updated={isUpdated('budget')} src={budgetSrc(brief.budget!)}>
          <BudgetBlock b={brief.budget!} />
        </SectionShell>
      )}

      {hasChannels(brief.channels) && (
        <SectionShell k="channels" updated={isUpdated('channels')} src={channelsSrc(brief.channels!)}>
          <ChannelsBlock c={brief.channels!} />
        </SectionShell>
      )}

      {hasCreative(brief.creative) && (
        <SectionShell k="creative" updated={isUpdated('creative')}>
          <CreativeBlock c={brief.creative!} />
        </SectionShell>
      )}

      {hasMeasurement(brief.measurement) && (
        <SectionShell k="measurement" updated={isUpdated('measurement')}>
          <MeasurementBlock m={brief.measurement!} />
        </SectionShell>
      )}

      {brief.deliverables && brief.deliverables.length > 0 && (
        <SectionShell k="deliverables" updated={isUpdated('deliverables')}>
          <ul className="cbw-deliverables">
            {brief.deliverables.map((d, i) => (
              <li key={i}>
                <b>{d.kind}</b>
                {d.eta && <span className="cbw-doc__chip">{d.eta}</span>}
                {d.note && <> — {d.note}</>}
              </li>
            ))}
          </ul>
        </SectionShell>
      )}

      {brief.openQuestions && brief.openQuestions.length > 0 && (
        <SectionShell
          k="openQuestions"
          updated={isUpdated('openQuestions')}
          chip={<span className="cbw-doc__chip miss">{brief.openQuestions.length} pending</span>}
        >
          <ul className="cbw-open-q">
            {brief.openQuestions.map((q, i) => (
              <li key={i}>
                <span className="cbw-open-q__num">Q{i + 1}</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </SectionShell>
      )}
    </div>
  );
}

// ── Doc header ──────────────────────────────────────────────────────────

function DocHeader({ brief, updatedCount }: { brief: Brief; updatedCount: number }) {
  const hasMeta = brief.agency || brief.client || brief.industry || brief.status;
  return (
    <>
      <div className="cbw-doc__eyebrow">
        <span className="pin">●</span>
        <span>Brief draft · auto-synthesized from sources</span>
        {updatedCount > 0 && (
          <span className="cbw-doc__eyebrow-upd">· {updatedCount} sections changed in last pass</span>
        )}
      </div>
      {brief.title && <h1>{brief.title}</h1>}
      {hasMeta && (
        <div className="cbw-doc__sub">
          {brief.agency && <span><b>Agency</b> · {brief.agency}</span>}
          {brief.client && <span><b>Advertiser</b> · {brief.client}</span>}
          {brief.industry && <span><b>Industry</b> · {brief.industry}</span>}
          {brief.status && <span><b>Status</b> · {brief.status}</span>}
        </div>
      )}
    </>
  );
}

// ── Section shell with ordinal + title + optional source + optional chip ─

function SectionShell({
  k, updated, children, src, chip,
}: {
  k: BriefSectionKey;
  updated: boolean;
  children: React.ReactNode;
  src?: string;
  chip?: React.ReactNode;
}) {
  return (
    <section>
      <h2 className={updated ? 'is-updated' : undefined}>
        <span>
          <span className="ord">{ORDINAL[k]}</span>
          {TITLE[k]}
          {chip}
          {updated && <span className="cbw-upd-badge">just updated</span>}
        </span>
        {src && <span className="src">{src}</span>}
      </h2>
      {children}
    </section>
  );
}

// ── Section blocks ──────────────────────────────────────────────────────

function MetaRow({ k, v, mono }: { k: string; v?: string | number; mono?: boolean }) {
  if (v == null || v === '') return null;
  return (
    <div className="cbw-meta-row">
      <span className="cbw-meta-row__k">{k}</span>
      <span className={`cbw-meta-row__v${mono ? ' mono' : ''}`}>{v}</span>
    </div>
  );
}

function Submission({ s }: { s: BriefSubmission }) {
  return (
    <div className="cbw-meta-grid">
      <MetaRow k="Client" v={s.client} />
      <MetaRow k="Vertical" v={s.vertical} />
      <MetaRow k="Client POC" v={s.clientPOC} mono />
      <MetaRow k="AI Digital POC" v={s.aidPOC} mono />
      <MetaRow k="Client type" v={s.clientType} />
      <MetaRow k="Due date" v={s.dueDate} mono />
      <MetaRow k="Priority" v={s.priority} />
    </div>
  );
}

function Goals({ g }: { g: BriefGoals }) {
  return (
    <>
      {(g.awarenessObjective || g.awarenessMeasure) && (
        <div className="cbw-goal cbw-goal--awareness">
          <div className="cbw-goal__head">
            <span className="cbw-goal__pill cbw-goal__pill--awareness">Awareness</span>
            {g.awarenessObjective && (
              <span className="cbw-goal__head-text">{g.awarenessObjective}</span>
            )}
          </div>
          {g.awarenessMeasure && (
            <div className="cbw-goal__measure"><b>Measure:</b> {g.awarenessMeasure}</div>
          )}
        </div>
      )}
      {(g.conversionObjective || g.conversionMeasure) && (
        <div className="cbw-goal cbw-goal--conversion">
          <div className="cbw-goal__head">
            <span className="cbw-goal__pill cbw-goal__pill--conv">Conversion</span>
            {g.conversionObjective && (
              <span className="cbw-goal__head-text">{g.conversionObjective}</span>
            )}
          </div>
          {g.conversionMeasure && (
            <div className="cbw-goal__measure"><b>Measure:</b> {g.conversionMeasure}</div>
          )}
        </div>
      )}
    </>
  );
}

function Audience({ a }: { a: BriefAudience }) {
  return (
    <>
      {a.primary && <p><b>Primary:</b> {a.primary}</p>}
      {a.personas && a.personas.length > 0 && (
        <div className="cbw-doc__personas">
          {a.personas.map((p, i) => (
            <div className="cbw-doc__persona" key={i}>
              <div className="cbw-doc__persona__avatar">
                {p.initial || p.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="cbw-doc__persona__name">
                  {p.name}{p.age ? `, ${p.age}` : ''}
                </div>
                {p.role && <div className="cbw-doc__persona__role">{p.role}</div>}
                {p.quote && <div className="cbw-doc__persona__quote">"{p.quote}"</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BudgetBlock({ b }: { b: BriefBudget }) {
  const total = (b.lines ?? []).reduce((sum, l) => sum + (l.amount || 0), 0);
  return (
    <>
      {b.lines && b.lines.length > 0 && (
        <div className="cbw-budget">
          {b.lines.map((line, i) => {
            const pct = total > 0 ? (line.amount / total) * 100 : 0;
            return (
              <div className="cbw-budget-line" key={i}>
                <div className="cbw-budget-line__name">{line.label}</div>
                <div className="cbw-budget-line__bar"><i style={{ width: `${pct}%` }} /></div>
                <div className="cbw-budget-line__amt">${line.amount.toLocaleString()}</div>
              </div>
            );
          })}
        </div>
      )}
      {b.phases && b.phases.length > 0 && (
        <div className="cbw-flight">
          {b.phases.map((phase, i) => (
            <div
              className={`cbw-flight__phase cbw-flight__phase--${phase.tone || 'sample'}`}
              key={i}
              style={{ left: `${phase.startPct}%`, width: `${phase.widthPct}%` }}
            >
              {phase.name}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ChannelsBlock({ c }: { c: BriefChannels }) {
  const total = (c.lines ?? []).reduce((sum, l) => sum + (l.amount || 0), 0);
  return (
    <>
      {c.lines && c.lines.length > 0 && (
        <div className="cbw-doc__channels">
          {c.lines.map((line, i) => {
            const pct = total > 0 ? (line.amount / total) * 100 : 0;
            return (
              <div className="cbw-doc__chan" key={i}>
                <div className="cbw-doc__chan__code">{line.code}</div>
                <div>{line.name}</div>
                <div className="cbw-doc__chan__bar"><i style={{ width: `${pct}%` }} /></div>
                <div className="cbw-doc__chan__amt">${(line.amount / 1000).toFixed(0)}k</div>
              </div>
            );
          })}
        </div>
      )}
      {((c.successTactics?.length ?? 0) > 0 || (c.failedTactics?.length ?? 0) > 0) && (
        <div className="cbw-tactic-pair">
          {c.successTactics && c.successTactics.length > 0 && (
            <div>
              <div className="cbw-tactic-pair__label">Proven tactics</div>
              {c.successTactics.map((t, i) => (
                <div className="cbw-tactic" key={i}>
                  {t.code && <div className="cbw-tactic__code">{t.code}</div>}
                  <div className="cbw-tactic__name">{t.name}</div>
                  <span className="cbw-tactic__status cbw-tactic__status--success">✓ proven</span>
                  {t.note && <div className="cbw-tactic__note">{t.note}</div>}
                </div>
              ))}
            </div>
          )}
          {c.failedTactics && c.failedTactics.length > 0 && (
            <div>
              <div className="cbw-tactic-pair__label">Avoid · learnings</div>
              {c.failedTactics.map((t, i) => (
                <div className="cbw-tactic" key={i}>
                  {t.code && <div className="cbw-tactic__code">{t.code}</div>}
                  <div className="cbw-tactic__name">{t.name}</div>
                  <span className="cbw-tactic__status cbw-tactic__status--risk">⚠ untested</span>
                  {t.note && <div className="cbw-tactic__note">{t.note}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function CreativeBlock({ c }: { c: BriefCreative }) {
  return (
    <>
      <div className="cbw-meta-grid">
        <MetaRow k="Materials available" v={c.materials} />
        <MetaRow k="Production help?" v={c.production} />
        <MetaRow k="Comms platform" v={c.commsPlatform} />
        <MetaRow k="Product RTB" v={c.rtb} />
      </div>
      {c.brandLine && <blockquote>{c.brandLine}</blockquote>}
    </>
  );
}

function MeasurementBlock({ m }: { m: BriefMeasurement }) {
  return (
    <div className="cbw-meta-grid">
      <MetaRow k="Benchmarks" v={m.benchmarks} mono />
      <MetaRow k="Conversion action" v={m.conversionAction} />
      <MetaRow k="Reporting cadence" v={m.reportingCadence} />
      <MetaRow k="Account ownership" v={m.accountOwnership} />
      <MetaRow k="Run in-house" v={m.inHouse} />
      <MetaRow k="Dashboarding" v={m.dashboarding} />
    </div>
  );
}

// ── Predicates: skip a section entirely if there's no data to show ──────

function hasSubmission(s?: BriefSubmission): s is BriefSubmission {
  return !!s && Object.values(s).some((v) => v != null && v !== '');
}
function hasGoals(g?: BriefGoals): g is BriefGoals {
  return !!g && Object.values(g).some((v) => v != null && v !== '');
}
function hasAudience(a?: BriefAudience): a is BriefAudience {
  return !!a && (Boolean(a.primary) || (a.personas?.length ?? 0) > 0);
}
function hasBudget(b?: BriefBudget): b is BriefBudget {
  return !!b && ((b.lines?.length ?? 0) > 0 || Boolean(b.flightStart) || Boolean(b.flightEnd) || (b.phases?.length ?? 0) > 0);
}
function hasChannels(c?: BriefChannels): c is BriefChannels {
  return !!c && ((c.lines?.length ?? 0) > 0 || (c.successTactics?.length ?? 0) > 0 || (c.failedTactics?.length ?? 0) > 0);
}
function hasCreative(c?: BriefCreative): c is BriefCreative {
  return !!c && Object.values(c).some((v) => v != null && v !== '');
}
function hasMeasurement(m?: BriefMeasurement): m is BriefMeasurement {
  return !!m && Object.values(m).some((v) => v != null && v !== '');
}

function budgetSrc(b: BriefBudget): string | undefined {
  const total = (b.lines ?? []).reduce((s, l) => s + (l.amount || 0), 0);
  const range = b.flightStart && b.flightEnd ? `${b.flightStart} → ${b.flightEnd}` : '';
  if (!total && !range) return undefined;
  return [total ? `$${total.toLocaleString()}` : '', range].filter(Boolean).join(' · ');
}

function channelsSrc(c: BriefChannels): string | undefined {
  const total = (c.lines ?? []).reduce((s, l) => s + (l.amount || 0), 0);
  return total ? `$${total.toLocaleString()} working media` : undefined;
}
