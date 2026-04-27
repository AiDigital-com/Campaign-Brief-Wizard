/**
 * Task worker — claims one task from `pipeline_tasks` and dispatches to the
 * matching background Lambda. Self-pings after success to drain the queue.
 *
 * Pattern (DS `createTaskWorker`):
 *   1. RPC `claim_task(p_app)` returns one pending task
 *   2. Look up `taskFunctionMap[task_type]` → background function name
 *   3. POST to `/.netlify/functions/{name}` with task payload
 *   4. Mark task complete (or pending+retry on failure)
 *   5. Self-ping to claim the next task
 *
 * EVERY function in `taskFunctionMap` MUST end with `-background`. Without
 * that suffix Netlify runs them in streaming mode (26s timeout) and the
 * `await fetch` in this worker will block until both die together.
 *
 * TODO: Map your app's task_types to function names.
 */
import { createTaskWorker } from '@AiDigital-com/design-system/server';

export default createTaskWorker({
  app: 'your-app-name',
  taskFunctionMap: {
    // task_type → background function filename (without .mts)
    run_audit: 'run-audit-background',
    // synthesize: 'synthesize-background',
    // review: 'review-background',
  },
});
