/**
 * Workspace — 3-pane shell for the brief-builder.
 *
 *   ┌────────────┬──────────────────────────┬────────────────────────┐
 *   │ AssetRail  │ {chat slot — ChatPanel}  │ BriefArtifact          │
 *   │ (uploads)  │                          │ (live patched output)  │
 *   └────────────┴──────────────────────────┴────────────────────────┘
 *
 * Stays presentational — owns no domain state. Brief patching, chat send,
 * file ingestion all live in App.tsx (and ultimately the orchestrator).
 *
 * On narrow viewports the artifact pane collapses behind a "Brief" tab
 * (toggle in CBW.css). Asset rail collapses to icon-only.
 */
import { type ReactNode } from 'react';
import { AssetRail } from './AssetRail';
import { BriefArtifact } from './BriefArtifact';
import type { Brief, BriefAsset } from '../lib/types';

interface Props {
  assets: BriefAsset[];
  onAssetsChange: (next: BriefAsset[]) => void;
  brief: Brief | null;
  chat: ReactNode;
}

export function Workspace({ assets, onAssetsChange, brief, chat }: Props) {
  return (
    <div className="cbw-workspace">
      <aside className="cbw-workspace__assets">
        <AssetRail assets={assets} onChange={onAssetsChange} />
      </aside>
      <section className="cbw-workspace__chat">{chat}</section>
      <aside className="cbw-workspace__brief">
        <BriefArtifact brief={brief} />
      </aside>
    </div>
  );
}
