import { defineHook } from "eve/hooks";

import { mintFreshPolicy } from "../sandbox/sandbox";

export default defineHook({
  events: {
    async "turn.started"(_event, ctx) {
      let remint: Promise<void>;
      try {
        remint = ctx.getSandbox().then(async (sandbox) => {
          await sandbox.setNetworkPolicy(await mintFreshPolicy());
        });
      } catch {
        return;
      }
      if (ctx.session.parent != null) {
        try {
          await remint;
        } catch {}
        return;
      }

      void remint.catch(() => {});
    },
  },
});
