/**
 * BriefMarkdown — text serialization of the brief (Markdown tab in artifact).
 *
 * Same rule as RenderedBrief: never emit a section heading for missing data.
 * The output is the same content readers see in the rendered view, just in
 * Markdown form — used both for the Markdown tab AND the export-as-markdown
 * action (slice 9).
 */
import type { Brief } from '../lib/types';

export function briefToMarkdown(brief: Brief): string {
  const out: string[] = [];

  if (brief.title) out.push(`# ${brief.title}`, '');

  const meta = [
    brief.agency && `**Agency:** ${brief.agency}`,
    brief.client && `**Advertiser:** ${brief.client}`,
    brief.industry && `**Industry:** ${brief.industry}`,
    brief.status && `**Status:** ${brief.status}`,
  ].filter(Boolean) as string[];
  if (meta.length) out.push(meta.join('  ·  '), '');

  // 01 Submission
  if (brief.submission && Object.values(brief.submission).some(Boolean)) {
    out.push('## 01 — Submission');
    const s = brief.submission;
    if (s.client)     out.push(`- Client: ${s.client}`);
    if (s.vertical)   out.push(`- Vertical: ${s.vertical}`);
    if (s.clientPOC)  out.push(`- Client POC: ${s.clientPOC}`);
    if (s.aidPOC)     out.push(`- AI Digital POC: ${s.aidPOC}`);
    if (s.clientType) out.push(`- Client type: ${s.clientType}`);
    if (s.dueDate)    out.push(`- Due: ${s.dueDate}`);
    if (s.priority)   out.push(`- Priority: ${s.priority}`);
    out.push('');
  }

  // 02 Background
  if (brief.background) {
    out.push('## 02 — Background', '', brief.background, '');
  }

  // 03 Goals
  if (brief.goals && Object.values(brief.goals).some(Boolean)) {
    out.push('## 03 — Goals & objectives');
    const g = brief.goals;
    if (g.awarenessObjective) out.push(`- **Awareness** — ${g.awarenessObjective}`);
    if (g.awarenessMeasure)   out.push(`  - Measure: ${g.awarenessMeasure}`);
    if (g.conversionObjective) out.push(`- **Conversion** — ${g.conversionObjective}`);
    if (g.conversionMeasure)   out.push(`  - Measure: ${g.conversionMeasure}`);
    out.push('');
  }

  // 04 KPIs
  if (brief.kpis?.length) {
    out.push('## 04 — Success metrics & benchmarks');
    for (const k of brief.kpis) {
      const base = k.base ? ` ${k.base} →` : '';
      out.push(`- **${k.label}** —${base} ${k.target}`);
    }
    out.push('');
  }

  // 05 Audience
  if (brief.audience && (brief.audience.primary || brief.audience.personas?.length)) {
    out.push('## 05 — Audience & personas');
    if (brief.audience.primary) out.push(brief.audience.primary, '');
    for (const p of brief.audience.personas ?? []) {
      const age = p.age ? `, ${p.age}` : '';
      out.push(`- **${p.name}${age}**${p.role ? ` · ${p.role}` : ''}`);
      if (p.quote) out.push(`  > "${p.quote}"`);
    }
    out.push('');
  }

  // 06 Competitors
  if (brief.competitors?.length) {
    out.push('## 06 — Competitive set');
    for (const c of brief.competitors) out.push(`- ${c}`);
    out.push('');
  }

  // 07 Geo
  if (brief.geos?.length) {
    out.push('## 07 — Geo & markets');
    for (const g of brief.geos) {
      const market = g.market ? ` — ${g.market}` : '';
      const star = g.primary ? ' ★' : '';
      out.push(`- 📍 ${g.city}${market}${star}`);
    }
    out.push('');
  }

  // 08 Budget
  if (brief.budget && (brief.budget.lines?.length || brief.budget.flightStart || brief.budget.flightEnd)) {
    out.push('## 08 — Budget & flighting');
    const total = (brief.budget.lines ?? []).reduce((s, l) => s + (l.amount || 0), 0);
    const range = brief.budget.flightStart && brief.budget.flightEnd
      ? ` · ${brief.budget.flightStart} → ${brief.budget.flightEnd}`
      : '';
    if (total) out.push(`Total: $${total.toLocaleString()}${range}`, '');
    for (const line of brief.budget.lines ?? []) {
      out.push(`- ${line.label} — $${line.amount.toLocaleString()}`);
    }
    if (brief.budget.phases?.length) {
      out.push('', 'Flight phases:');
      for (const p of brief.budget.phases) {
        out.push(`- ${p.name} (${p.startPct}% – ${p.startPct + p.widthPct}%)`);
      }
    }
    out.push('');
  }

  // 09 Channels
  if (brief.channels && (brief.channels.lines?.length || brief.channels.successTactics?.length || brief.channels.failedTactics?.length)) {
    out.push('## 09 — Channels & tactics');
    for (const line of brief.channels.lines ?? []) {
      out.push(`- [${line.code}] ${line.name} — $${line.amount.toLocaleString()}`);
    }
    if (brief.channels.successTactics?.length) {
      out.push('', '**Proven tactics:**');
      for (const t of brief.channels.successTactics) {
        out.push(`- ✓ ${t.name}${t.note ? ` — ${t.note}` : ''}`);
      }
    }
    if (brief.channels.failedTactics?.length) {
      out.push('', '**Avoid · learnings:**');
      for (const t of brief.channels.failedTactics) {
        out.push(`- ⚠ ${t.name}${t.note ? ` — ${t.note}` : ''}`);
      }
    }
    out.push('');
  }

  // 10 Creative
  if (brief.creative && Object.values(brief.creative).some(Boolean)) {
    out.push('## 10 — Creative & messaging');
    const c = brief.creative;
    if (c.materials)     out.push(`- Materials: ${c.materials}`);
    if (c.production)    out.push(`- Production: ${c.production}`);
    if (c.commsPlatform) out.push(`- Comms platform: ${c.commsPlatform}`);
    if (c.rtb)           out.push(`- Product RTB: ${c.rtb}`);
    if (c.brandLine)     out.push('', `> ${c.brandLine}`);
    out.push('');
  }

  // 11 Measurement
  if (brief.measurement && Object.values(brief.measurement).some(Boolean)) {
    out.push('## 11 — Measurement & ops');
    const m = brief.measurement;
    if (m.benchmarks)        out.push(`- Benchmarks: ${m.benchmarks}`);
    if (m.conversionAction)  out.push(`- Conversion action: ${m.conversionAction}`);
    if (m.reportingCadence)  out.push(`- Reporting cadence: ${m.reportingCadence}`);
    if (m.accountOwnership)  out.push(`- Account ownership: ${m.accountOwnership}`);
    if (m.inHouse)           out.push(`- Run in-house: ${m.inHouse}`);
    if (m.dashboarding)      out.push(`- Dashboarding: ${m.dashboarding}`);
    out.push('');
  }

  // 12 Deliverables
  if (brief.deliverables?.length) {
    out.push('## 12 — Deliverables');
    for (const d of brief.deliverables) {
      const eta = d.eta ? ` (${d.eta})` : '';
      const note = d.note ? ` — ${d.note}` : '';
      out.push(`- **${d.kind}**${eta}${note}`);
    }
    out.push('');
  }

  // 13 Open questions
  if (brief.openQuestions?.length) {
    out.push('## 13 — Open questions');
    brief.openQuestions.forEach((q, i) => out.push(`${i + 1}. ${q}`));
    out.push('');
  }

  return out.join('\n').trimEnd() + '\n';
}

export function MarkdownView({ brief }: { brief: Brief }) {
  return <pre className="cbw-md">{briefToMarkdown(brief)}</pre>;
}
