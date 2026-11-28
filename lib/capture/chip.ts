import type { Capture } from './types';

/** The words the sent chip shows for a capture, or null once it has nothing more to say. */
export function chipLabel(row: Capture | undefined, names: Record<string, string>): string | null {
  if (!row) return null;
  const where = (row.project_id && names[row.project_id]) || 'Home';
  if (row.status === 'routing') return 'Routing…';
  if (row.status === 'queued') return `Queued in ${where}`;
  if (row.status === 'working') return `Working in ${where}`;
  if (row.status === 'ready') return `Answered in ${where}`;
  if (row.status === 'failed') return 'Interrupted. See the Inbox to resume.';
  return null;
}
