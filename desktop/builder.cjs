module.exports = {
  appId: "dev.thunk.desktop",
  productName: "Thunk",
  directories: { app: "desktop", output: "dist-desktop" },
  files: ["connections.cjs", "connections-preload.cjs", "connections.html", "connections.js", "releases.cjs", "main.cjs", "runtime.cjs", "updater.cjs", "update.html", "update.js", "offline.html", "offline.js", "package.json", "!node_modules/**/*"],
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
};
