'use client';
import { useEffect } from 'react';
import { flushAll, unsavedIds, useBoard } from '@/lib/store/board-store';
export function useBoardPersistence(projectId: string, boardId = 'main') {
    const dirty = useBoard(s => s.dirty);
    useEffect(() => { const timer = setTimeout(() => { void flushAll(projectId, boardId).catch(e => useBoard.setState({ error: String(e.message) })); }, 600); return () => clearTimeout(timer); }, [dirty, projectId, boardId]);
    useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (unsavedIds().length)
        e.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
}
