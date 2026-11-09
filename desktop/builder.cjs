module.exports = {
  appId: "dev.thunk.desktop",
  productName: "Thunk",
  directories: { app: "desktop", output: "dist-desktop" },
  files: ["main.cjs", "runtime.cjs", "package.json", "!node_modules/**/*"],
  extraResources: [{ from: "build/desktop", to: "backend" }],
  npmRebuild: false,
  mac: {
    target: "dir",
    identity: "-",
    hardenedRuntime: false,
    notarize: false,
    category: "public.app-category.developer-tools",
  },
};
