export type ProcessKind = "setup" | "run" | "archive" | "shell";
export type ProcessSnapshot = {
  id: string;
  kind: ProcessKind;
  command: string;
  running: boolean;
  exitCode: number | null;
  output: string;
  offset: number;
};
export type RuntimeSnapshot = {
  port: number;
  archived: boolean;
  previewUrl: string | null;
  setupError: string | null;
  busy: boolean;
  scripts: { setup?: string; run?: string; archive?: string };
  processes: ProcessSnapshot[];
};
