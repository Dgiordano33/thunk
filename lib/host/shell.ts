/**
 * How to run a command string or open an interactive shell on this host.
 *
 * macOS and Linux use the user's login shell (`$SHELL -lc`), so scripts see the same PATH as a
 * terminal (nvm, Homebrew, asdf). Windows has no login shell: commands go through `cmd.exe`,
 * which is what `npm run` uses there too, unless `SHELL` points at a POSIX shell such as
 * Git Bash, and the interactive terminal opens PowerShell.
 */
export type ShellSpec = {
  file: string;
  args: string[];
  /** Windows only: pass `args` to the process exactly as given, without Node's quoting. */
  verbatim?: boolean;
};

type Host = { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv };

const isPosixShell = (shell: string | undefined) => !!shell && /(^|[\\/])(ba|z|fi|k|da)?sh(\.exe)?$/i.test(shell);

/** The default shell for commands: `$SHELL`, else bash (zsh on macOS), else `cmd.exe` on Windows. */
export function defaultShell({ platform = process.platform, env = process.env }: Host = {}) {
  if (platform === "win32") return isPosixShell(env.SHELL) ? env.SHELL! : env.ComSpec || "cmd.exe";
  return env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

/** Run `command` as a shell command line, through the login shell where there is one. */
export function commandShell(command: string, host: Host = {}): ShellSpec {
  const file = defaultShell(host);
  if ((host.platform ?? process.platform) === "win32" && !isPosixShell(file)) {
    // /s keeps cmd from mangling the quotes inside `command`; Node must not re-quote it.
    return { file, args: ["/d", "/s", "/c", `"${command}"`], verbatim: true };
  }
  return { file, args: ["-lc", command] };
}

/** An interactive terminal: a login shell, or PowerShell on Windows. */
export function interactiveShell({ platform = process.platform, env = process.env }: Host = {}): ShellSpec {
  if (platform === "win32") {
    if (isPosixShell(env.SHELL)) return { file: env.SHELL!, args: ["-l"] };
    return { file: "powershell.exe", args: ["-NoLogo"] };
  }
  return { file: defaultShell({ platform, env }), args: ["-l"] };
}
