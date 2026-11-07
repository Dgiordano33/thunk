// Shared between server and client.

export type CommentKind = "change" | "question" | "side_chat";
export type CommentStatus = "open" | "resolved";

export type CommentReply = { id: string; body: string; createdAt: string };

export type DocComment = {
  id: string;
  documentId: string;
  kind: CommentKind;
  status: CommentStatus;
  body: string;
  /** Snapshot of the marked text at creation; the live mark is the source of truth. */
  quote: string;
  from?: number;
  to?: number;
  createdAt: string;
  replies: CommentReply[];
};

export type DocumentKind = "response" | "plan";
export type DocumentStatus = "draft" | "sent" | "approved";

export type PersistedDocument = {
  id: string;
  kind: DocumentKind;
  parentDocumentId: string | null;
  version: number;
  originalMarkdown: string;
  baselineMarkdown: string | null;
  currentMarkdown: string;
  contentJson: unknown | null;
  status: DocumentStatus;
  comments: DocComment[];
};

/** A document as listed in the workspace panel: the latest version of one response or plan. */
export type Artifact = {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  kind: DocumentKind;
  version: number;
  status: DocumentStatus;
  title: string;
  openComments: number;
  createdAt: string;
};
