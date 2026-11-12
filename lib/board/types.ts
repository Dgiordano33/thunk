import type { JSONContent } from '@tiptap/core';
export type Reply = {
    id: string;
    body: string;
    author: 'user' | 'agent';
    sentAt: string | null;
};
export type BoardComment = Reply & {
    quote: string;
    resolved: boolean;
    detached?: boolean;
    replies: Reply[];
    x?: number;
    y?: number;
};
export type Stroke = {
    id: string;
    points: {
        x: number;
        y: number;
    }[];
    sentAt: string | null;
};
export type Card = {
    id: string;
    rev: number;
    kind: 'doc' | 'image';
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    author: 'user' | 'agent';
    markdown: string;
    baselineMarkdown: string;
    contentJson?: JSONContent;
    comments: BoardComment[];
    strokes: Stroke[];
    asset?: string;
    mime?: string;
    sentAt: string | null;
    agentEdit?: {
        markdown: string;
        contentJson?: JSONContent;
        summary: string;
    };
};
export type Board = {
    id: string;
    rev: number;
    viewport: {
        x: number;
        y: number;
        zoom: number;
    };
    edges: {
        source: string;
        target: string;
    }[];
    tombstones: string[];
    agent: {
        sessionId: string;
        sdkSessionId: string | null;
    } | null;
    lastSend: string | null;
};
export type Snapshot = {
    board: Board;
    cards: Card[];
};
export type BoardOp = {
    card: Card;
};
