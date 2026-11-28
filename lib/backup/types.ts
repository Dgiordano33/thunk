// Shared between server and client.

/** `config/backup.json`: the daily backup schedule. */
export type BackupSettings = {
  enabled: boolean;
  /** "HH:MM", in `tz` (the browser's zone when saved from Settings), else the server's. */
  time: string;
  tz: string | null;
  /** How many archives to keep; older ones are deleted after each backup. */
  keep: number;
  /** Where archives go; null means `<data dir>/backups`. */
  dir: string | null;
};

export type BackupFile = { name: string; size: number; createdAt: string };

export type BackupStatus = {
  settings: BackupSettings;
  /** The resolved folder archives are written to. */
  dir: string;
  backups: BackupFile[];
  nextRunAt: string | null;
  running: boolean;
  lastError: { at: string; message: string } | null;
};
