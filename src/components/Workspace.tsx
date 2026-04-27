/**
 * Workspace — center column (top assets, bottom chat) + right artifact pane.
 *
 *   ┌─────────────────────────────┬────────────────────────┐
 *   │  AssetRail                  │  BriefArtifact         │
 *   │  (top, max ~42vh)           │                        │
 *   ├─────────────────────────────┤                        │
 *   │  {chat slot — ChatPanel}    │  (right, ~480-640px)   │
 *   │  (fills remainder)          │                        │
 *   └─────────────────────────────┴────────────────────────┘
 *
 * Below 1100px the artifact column hides — slice 8 will add a "show brief"
 * toggle for narrow viewports.
 *
 * AppShell owns the outer sidebar + header chrome; this component only fills
 * the main-content area.
 */
import { type ReactNode } from 'react';
import type { SupabaseClient } from '@AiDigital-com/design-system';
import { AssetRail } from './AssetRail';
import { BriefArtifact } from './BriefArtifact';
import type { Brief, BriefAsset, BriefSectionKey } from '../lib/types';

interface Props {
  assets: BriefAsset[];
  onUpload: (files: File[]) => void | Promise<void>;
  onRemove: (assetId: string) => void | Promise<void>;
  brief: Brief | null;
  versionNumber?: number;
  changedSections?: BriefSectionKey[];
  supabase?: SupabaseClient | null;
  sessionId?: string | null;
  chat: ReactNode;
}

export function Workspace({
  assets, onUpload, onRemove, brief, versionNumber, changedSections,
  supabase, sessionId, chat,
}: Props) {
  return (
    <div className="cbw-workspace">
      <section className="cbw-workspace__center">
        <div className="cbw-workspace__assets">
          <AssetRail assets={assets} onUpload={onUpload} onRemove={onRemove} />
        </div>
        <div className="cbw-workspace__chat">{chat}</div>
      </section>
      <aside className="cbw-workspace__brief">
        <BriefArtifact
          brief={brief}
          assets={assets}
          versionNumber={versionNumber}
          changedSections={changedSections}
          supabase={supabase}
          sessionId={sessionId}
        />
      </aside>
    </div>
  );
}
