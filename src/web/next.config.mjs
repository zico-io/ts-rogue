import { withEve } from "eve/next";

const config = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default withEve(config, {
  eveRoot: new URL("../../agent", import.meta.url).pathname,
});
