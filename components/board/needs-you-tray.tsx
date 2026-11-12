'use client';
import { useSession } from '@/lib/store/session-store';
import { AskQuestionForm } from '@/components/approvals/ask-question-form';
import { PermissionCard } from '@/components/approvals/permission-card';
export function NeedsYouTray() {
    const requests = useSession(s => s.requests);
    return <aside className="absolute right-4 bottom-20 z-30 max-h-[60vh] w-96 overflow-auto bg-background" aria-label="Needs you">{Object.values(requests).filter(r => r.status === 'pending').map(r => r.kind === 'question' ? <AskQuestionForm key={r.id} requestId={r.id}/> : r.kind === 'permission' ? <PermissionCard key={r.id} requestId={r.id}/> : null)}</aside>;
}
