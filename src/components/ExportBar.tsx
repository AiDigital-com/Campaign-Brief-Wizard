/**
 * ExportBar — sticky footer in the artifact pane.
 *
 * v1 ships MD + PDF only (per scope decision). DOCX + Hand off → are
 * deferred until we have a downstream API to hand off to.
 *
 * - MD:  briefToMarkdown(brief) → DS downloadMarkdown
 * - PDF: DS downloadVisualPDF(.cbw-doc) — captures the actual rendered
 *        artifact, not raw markdown, so KPI tiles, persona cards, flight
 *        bar, etc. all survive into the file.
 *
 * The PDF export deliberately captures the `.cbw-doc` selector inside the
 * artifact body — that's the same DOM the user sees in the Rendered tab.
 * If the user is on Markdown or Sources, we briefly switch to Rendered
 * before capture (slice 9.1 if needed; v1 just disables the PDF button on
 * non-Rendered tabs to keep the contract obvious).
 */
import { useState } from 'react';
import { downloadMarkdown, downloadVisualPDF } from '@AiDigital-com/design-system';
import { briefToMarkdown } from './BriefMarkdown';
import type { Brief } from '../lib/types';

interface Props {
  brief: Brief | null;
  /** Currently active tab — PDF is rendered-tab only. */
  tab: 'rendered' | 'markdown' | 'sources';
}

export function ExportBar({ brief, tab }: Props) {
  const [busy, setBusy] = useState<'md' | 'pdf' | null>(null);
  const disabled = !brief || Object.keys(brief).length <= 1;
  const title = brief?.title || 'campaign-brief';

  const onMD = () => {
    if (!brief || disabled || busy) return;
    setBusy('md');
    try {
      downloadMarkdown(briefToMarkdown(brief), title);
    } finally {
      setBusy(null);
    }
  };

  const onPDF = async () => {
    if (!brief || disabled || busy) return;
    if (tab !== 'rendered') {
      // Soft hint — the button is also disabled in this case, but guard anyway.
      return;
    }
    setBusy('pdf');
    try {
      await downloadVisualPDF('.cbw-brief__body .cbw-doc', title);
    } catch (err) {
      console.error('[cbw] PDF export failed:', err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cbw-export">
      <div className="cbw-export__hint">
        {disabled
          ? 'Build a draft first — exports unlock once the brief has content.'
          : tab === 'rendered'
            ? 'Export ready'
            : 'Switch to Rendered to export PDF'}
      </div>
      <div className="cbw-export__btns">
        <button
          type="button"
          className="cbw-export__btn"
          disabled={disabled || busy != null}
          onClick={onMD}
        >
          {busy === 'md' ? 'Saving…' : '↓ MD'}
        </button>
        <button
          type="button"
          className="cbw-export__btn"
          disabled={disabled || busy != null || tab !== 'rendered'}
          onClick={onPDF}
          title={tab !== 'rendered' ? 'Switch to Rendered tab to export PDF' : undefined}
        >
          {busy === 'pdf' ? 'Rendering…' : '↓ PDF'}
        </button>
      </div>
    </div>
  );
}
