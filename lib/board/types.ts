import type { JSONContent } from '@tiptap/core';
import type { ChartAnchor, ChartSpec } from './chart';
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
    /** A pin on a chart: the data point it marks. */
    anchor?: ChartAnchor;
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
    kind: 'doc' | 'image' | 'drawing' | 'chart';
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
    /** What a chart card plots; the client renders it, so the agent can read and patch the rows. */
    chart?: ChartSpec;
    /** The chart as the agent last saw it, while the user has unsent hand edits to its data. */
    baselineChart?: ChartSpec;
    /** A command the agent registered that prints the chart's data as JSON; Refresh re-runs it. */
    chartSource?: {
        command: string;
        /** The user has confirmed this exact command once, so Refresh runs it without asking again. */
        approved?: boolean;
        refreshedAt?: string;
    };
    mime?: string;
    sentAt: string | null;
    /** Id of the card this one is stacked directly under; the client keeps it there as heights change. Cleared when the user moves it. */
    below?: string | null;
    /** An instruction the user asked about a focused group; shown as a chip with the reply chained under it. */
    prompt?: boolean;
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
