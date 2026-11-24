module.exports = {
  appId: "dev.thunk.desktop",
  productName: "Thunk",
  directories: { app: "desktop", output: "dist-desktop" },
  files: ["connections.cjs", "connections-preload.cjs", "connections.html", "connections.js", "releases.cjs", "setup-sync.cjs", "app-preload.cjs", "capture.cjs", "capture-preload.cjs", "main.cjs", "runtime.cjs", "updater.cjs", "update.html", "update.js", "offline.html", "offline.js", "prerequisites.cjs", "icon.png", "package.json", "!node_modules/**/*"],
  extraResources: [{ from: "build/desktop", to: "backend" }],
  npmRebuild: false,
  mac: {
    icon: "desktop/icon.png",
    target: "dir",
    identity: "-",
    hardenedRuntime: false,
    notarize: false,
    category: "public.app-category.developer-tools",
  },
  // Like the Mac build, an unpacked folder that scripts/archive-desktop.mjs zips; no installer or signing.
  linux: {
    icon: "desktop/icon.png",
    target: "dir",
    executableName: "thunk",
    category: "Development",
  },
  win: {
    icon: "desktop/icon.png",
    target: "dir",
  },
};
