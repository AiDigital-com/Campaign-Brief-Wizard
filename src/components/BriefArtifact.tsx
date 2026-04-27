/**
 * BriefArtifact — right pane. Live-updating campaign brief.
 *
 * Renders ONLY fields that have data. Empty `Brief` = empty pane with a
 * subtle "the brief will appear here as we talk" hint. NO placeholder
 * copy ever (see /CLAUDE.md "No content fallbacks").
 *
 * Section ordering matches the strategic flow most planners follow —
 * audience → objective → SMP → mindset shift → brand → channels →
 * deliverables → constraints → open questions.
 */
import type { Brief } from '../lib/types';

interface Props {
  brief: Brief | null;
}

export function BriefArtifact({ brief }: Props) {
  const isEmpty = !brief || Object.keys(brief).filter(k => k !== 'lastUpdatedAt').length === 0;

  if (isEmpty) {
    return (
      <div className="cbw-brief cbw-brief--empty">
        <div className="cbw-brief__empty-hint">
          The brief will appear here as we talk.
        </div>
      </div>
    );
  }

  const b = brief!;

  return (
    <div className="cbw-brief">
      {b.title && <h1 className="cbw-brief__title">{b.title}</h1>}

      <Section label="Audience" value={b.audience} />
      <Section label="Objective" value={b.objective} />
      <Section label="Single-minded proposition" value={b.singleMindedProposition} />

      {(b.currentMindset || b.desiredMindset) && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Mindset shift</h3>
          <div className="cbw-brief__mindset">
            {b.currentMindset && (
              <div>
                <span className="cbw-brief__mindset-label">From</span>
                <p>{b.currentMindset}</p>
              </div>
            )}
            {b.desiredMindset && (
              <div>
                <span className="cbw-brief__mindset-label">To</span>
                <p>{b.desiredMindset}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {b.brand && Object.values(b.brand).some(Boolean) && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Brand</h3>
          {b.brand.name && <p><strong>Name:</strong> {b.brand.name}</p>}
          {b.brand.archetype && <p><strong>Archetype:</strong> {b.brand.archetype}</p>}
          {b.brand.toneOfVoice && <p><strong>Tone of voice:</strong> {b.brand.toneOfVoice}</p>}
          {b.brand.personality && b.brand.personality.length > 0 && (
            <p><strong>Personality:</strong> {b.brand.personality.join(' · ')}</p>
          )}
          {b.brand.competitiveContext && (
            <p><strong>Competitive context:</strong> {b.brand.competitiveContext}</p>
          )}
        </div>
      )}

      {b.channels && b.channels.length > 0 && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Channels</h3>
          <ul className="cbw-brief__list">
            {b.channels.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {b.deliverables && b.deliverables.length > 0 && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Deliverables</h3>
          <ul className="cbw-brief__list">
            {b.deliverables.map((d) => (
              <li key={d.id}>
                <strong>{d.format}</strong>
                {d.specs && <> — {d.specs}</>}
                {d.notes && <span className="cbw-brief__note"> ({d.notes})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {b.timing && (b.timing.kickoffDate || b.timing.launchDate || (b.timing.milestones && b.timing.milestones.length)) && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Timing</h3>
          {b.timing.kickoffDate && <p><strong>Kickoff:</strong> {b.timing.kickoffDate}</p>}
          {b.timing.launchDate && <p><strong>Launch:</strong> {b.timing.launchDate}</p>}
          {b.timing.milestones && b.timing.milestones.length > 0 && (
            <ul className="cbw-brief__list">
              {b.timing.milestones.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
        </div>
      )}

      {b.budget && (b.budget.amount || b.budget.notes) && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Budget</h3>
          {b.budget.amount && (
            <p>{b.budget.currency || 'USD'} {b.budget.amount.toLocaleString()}</p>
          )}
          {b.budget.notes && <p className="cbw-brief__note">{b.budget.notes}</p>}
        </div>
      )}

      {b.mandatories && b.mandatories.length > 0 && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Mandatories</h3>
          <ul className="cbw-brief__list">
            {b.mandatories.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      {b.doNots && b.doNots.length > 0 && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Do not</h3>
          <ul className="cbw-brief__list">
            {b.doNots.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      {b.legalNotes && (
        <div className="cbw-brief__section">
          <h3 className="cbw-brief__heading">Legal & compliance</h3>
          <p>{b.legalNotes}</p>
        </div>
      )}

      {b.openQuestions && b.openQuestions.length > 0 && (
        <div className="cbw-brief__section cbw-brief__section--open">
          <h3 className="cbw-brief__heading">Still open</h3>
          <ul className="cbw-brief__list">
            {b.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="cbw-brief__section">
      <h3 className="cbw-brief__heading">{label}</h3>
      <p>{value}</p>
    </div>
  );
}
