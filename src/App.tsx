/**
 * Campaign Brief Wizard — 3-pane iterative workspace.
 *
 * Layout:
 *   ┌──────────┬─────────────────────┬─────────────────────┐
 *   │ uploads  │ dialogue (chat)     │ brief (live artifact)│
 *   │ (left)   │ (center)            │ (right)             │
 *   └──────────┴─────────────────────┴─────────────────────┘
 *
 * Workflow (Opus-style artifact-as-you-go):
 *   1. User drops files → orchestrator ingests + extracts initial brief skeleton
 *   2. Orchestrator streams text deltas to chat AND brief deltas to artifact
 *   3. User adds more files / refines via dialogue → brief updates incrementally
 *   4. Brief is the persisted artifact; chat history accompanies it
 *
 * Key differences from other apps in the portfolio:
 *   - No "scan / synthesize / review" pipeline — single orchestrator owns the
 *     brief artifact and streams updates as the user converses
 *   - Brief lives in `cbw_sessions.brief_data` and is patched in place
 *   - Multi-file ingest via DS UploadZone (multiple=true), files stored in
 *     `cbw_assets` table with thumbnails when available
 *
 * Sidebar lists prior briefs; selecting one rehydrates dialogue + artifact.
 */
import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';
import { AppShell, ChatPanel, Sidebar, useSessionPersistence } from '@AiDigital-com/design-system';
import type { SupabaseClient, SidebarItem } from '@AiDigital-com/design-system';
import { createClient } from '@supabase/supabase-js';
import { SignIn, UserButton, useAuth } from '@clerk/react';
import { Workspace } from './components/Workspace';
import type { Brief, BriefAsset, BriefSectionKey, ChatMessage } from './lib/types';
import './App.css';

// ── App Config ───────────────────────────────────────────────────────────────
const APP_NAME = 'campaign-brief-wizard';
const APP_TITLE = 'Campaign Brief Wizard';
const SESSION_TABLE = 'cbw_sessions';
const TITLE_FIELD = 'brief_title';
const ACTIVITY_LABEL = 'Brief';

const supabaseConfig = import.meta.env.VITE_SUPABASE_URL ? {
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  createClient: createClient as any,
} : undefined;

interface BriefSession extends SidebarItem {
  title: string;
}

export default function App() {
  const { userId } = useAuth();

  const [sidebarItems, setSidebarItems] = useState<BriefSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sidebarSupabase, setSidebarSupabase] = useState<SupabaseClient | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!sidebarSupabase) return;
    sidebarSupabase.from(SESSION_TABLE)
      .select(`id, ${TITLE_FIELD}, status, created_at`)
      .eq('deleted_by_user', false)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }: any) => {
        setSidebarItems((data ?? []).map((r: any) => ({
          id: r.id,
          title: r[TITLE_FIELD] || 'Untitled brief',
          status: r.status,
          createdAt: r.created_at,
        })));
      });
  }, [refreshKey, sidebarSupabase]);

  const handlersRef = useRef<{
    onSelect: (id: string) => void;
    onNew: () => void;
    onDelete: (id: string) => void;
  }>({ onSelect: () => {}, onNew: () => {}, onDelete: () => {} });

  return (
    <AppShell
      appTitle={APP_TITLE}
      activityLabel={ACTIVITY_LABEL}
      auth={{ SignIn, UserButton, useAuth }}
      supabaseConfig={supabaseConfig}
      helpUrl="/help"
      sidebar={
        <Sidebar
          items={sidebarItems}
          activeId={activeSessionId}
          loadingId={loadingId}
          onSelect={(id) => handlersRef.current.onSelect(id)}
          onNew={() => handlersRef.current.onNew()}
          onDelete={(id) => handlersRef.current.onDelete(id)}
          renderItem={(item) => <span>{(item as BriefSession).title}</span>}
          newLabel={`+ New ${ACTIVITY_LABEL}`}
          emptyMessage={`No ${ACTIVITY_LABEL.toLowerCase()}s yet.`}
        />
      }
    >
      {({ authFetch, supabase }) => (
        <AppContent
          authFetch={authFetch}
          supabase={supabase}
          userId={userId}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          setLoadingId={setLoadingId}
          setRefreshKey={setRefreshKey}
          handlersRef={handlersRef}
          setSidebarSupabase={setSidebarSupabase}
        />
      )}
    </AppShell>
  );
}

interface AppContentProps {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  supabase: SupabaseClient | null;
  userId: string | null | undefined;
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setLoadingId: Dispatch<SetStateAction<string | null>>;
  setRefreshKey: Dispatch<SetStateAction<number>>;
  handlersRef: React.MutableRefObject<{
    onSelect: (id: string) => void;
    onNew: () => void;
    onDelete: (id: string) => void;
  }>;
  setSidebarSupabase: Dispatch<SetStateAction<SupabaseClient | null>>;
}

function AppContent({
  authFetch, supabase, userId,
  setActiveSessionId, setLoadingId, setRefreshKey,
  handlersRef, setSidebarSupabase,
}: AppContentProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assets, setAssets] = useState<BriefAsset[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | undefined>();
  const [changedSections, setChangedSections] = useState<BriefSectionKey[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void setVersionNumber; void setChangedSections;  // wired in slice 5

  useEffect(() => { setSidebarSupabase(supabase); }, [supabase, setSidebarSupabase]);

  const session = useSessionPersistence(supabase, authFetch, userId ?? null, {
    table: SESSION_TABLE,
    app: APP_NAME,
    titleField: TITLE_FIELD,
    mergeConfig: { objectFields: ['brief_data', 'intake_summary'] },
    defaultFields: { status: 'drafting' },
    mergeEndpoint: '/.netlify/functions/save-session',
    sessionsEndpoint: '/.netlify/functions/get-sessions',
  });

  useEffect(() => {
    handlersRef.current = {
      onSelect: async (id: string) => {
        if (!supabase) return;
        setLoadingId(id);
        const { data } = await supabase.from(SESSION_TABLE).select('*').eq('id', id).maybeSingle();
        setLoadingId(null);
        if (!data) return;
        session.loadSession(id);
        setActiveSessionId(id);
        setMessages(data.messages || []);
        setBrief(data.brief_data || null);
        setAssets(data.assets || []);
      },
      onNew: () => {
        session.newSession();
        setMessages([]);
        setBrief(null);
        setAssets([]);
        setVersionNumber(undefined);
        setChangedSections([]);
        setActiveSessionId(null);
        setError(null);
      },
      onDelete: async (id: string) => {
        session.deleteSession(id);
        setRefreshKey(k => k + 1);
      },
    };
  }, [supabase, session, setActiveSessionId, setLoadingId, setRefreshKey, handlersRef]);

  // Wire orchestrator (parallel thread will implement). Streams text deltas to
  // chat AND structured brief patches to the artifact.
  const handleSend = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    session.addMessage(userMsg as never);
    setStreaming(true);
    setError(null);

    // Slice 5 will replace this with a real SSE pipeline:
    //   { type: 'text_delta', text }
    //   { type: 'brief_patch', patch, changedSections }
    //   { type: 'version_committed', versionNumber, changedSections }
    //   { type: 'done' }
    setTimeout(() => {
      const reply: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Orchestrator wiring lands in slice 5.',
      };
      setMessages((prev) => [...prev, reply]);
      session.addMessage(reply as never);
      setStreaming(false);
    }, 400);
  }, [session]);

  const handleAssetsChange = useCallback((next: BriefAsset[]) => {
    setAssets(next);
    // TODO (parallel thread): trigger ingest endpoint to extract a brief
    //   skeleton from the new assets, then merge result into brief state.
  }, []);

  return (
    <Workspace
      assets={assets}
      onAssetsChange={handleAssetsChange}
      brief={brief}
      versionNumber={versionNumber}
      changedSections={changedSections}
      chat={
        <ChatPanel
          messages={messages.filter((m) => m.role !== 'system') as never}
          streaming={streaming}
          error={error}
          onSend={handleSend}
          welcomeIcon="📝"
          welcomeTitle={`Welcome to ${APP_TITLE}`}
          welcomeDescription="Drop in research, transcripts, briefs from clients — and we'll synthesize a coherent campaign brief as we talk."
          placeholder="Describe the campaign goal, or ask a question…"
        />
      }
    />
  );
}
