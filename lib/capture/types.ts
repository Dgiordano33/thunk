export type Capture = {
 message_id?: string | null;
 id: string; text: string; status: 'routing' | 'queued' | 'working' | 'ready' | 'kept' | 'discarded' | 'failed';
 project_id: string | null; task_id: string | null; workspace_id: string | null; session_id: string | null;
 mode: 'scout' | 'worktree' | null; title: string | null; assumptions: string[]; next_step: string | null;
 summary: string | null; diff_stat: unknown; cost_usd: number; error: string | null; created_at: string; updated_at: string;
};
