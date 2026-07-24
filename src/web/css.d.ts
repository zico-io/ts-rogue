// Next.js resolves CSS imports through its bundler; this ambient declaration
// lets the repo's `tsgo --noEmit` typecheck accept the side-effect `import
// "./globals.css"` in the app shell.
declare module "*.css";
