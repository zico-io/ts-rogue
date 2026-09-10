const config = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // The splash screen imports the game's own title art from ../../ui.
  experimental: { externalDir: true },
  // The session route uploads the game bundle into sandboxes; ship it with the function.
  outputFileTracingIncludes: { "/api/session": ["./dist/**"] },
};

export default config;
