/**
 * Dispatch handler — accepts a user request, upserts the session row, enqueues
 * the first pipeline task, and kicks the task-worker. Returns 200 in under 3s.
 *
 * The DS `createDispatchHandler` does the heavy lifting:
 *   1. Resolves auth (or anonymous if `skipAuth: true` for mobile flows)
 *   2. Upserts a row in `sessionTable` with intake_summary
 *   3. Inserts `run_audit` task into `pipeline_tasks`
 *   4. POSTs to `/.netlify/functions/task-worker` to start dispatching
 *   5. Returns `{ dispatched: true, jobId }`
 *
 * Long-running work happens in `-background` Lambdas claimed by task-worker —
 * NEVER inline in this handler (would hit 26s timeout).
 *
 * TODO: Set `app` slug + `sessionTable` to match your app.
 */
import { createDispatchHandler } from '@AiDigital-com/design-system/server';

// CBW does not currently use the batch pipeline — orchestrator owns the
// brief artifact and patches it incrementally via patch_brief tool calls.
// Kept wired so a future phase (e.g. a batched "synthesize" pass on demand)
// can opt in by inserting tasks into pipeline_tasks.
export default createDispatchHandler({
  app: 'campaign-brief-wizard',
  sessionTable: 'cbw_sessions',
  // skipAuth: true,
  // anonymousUserId: 'mobile:anonymous',
});
