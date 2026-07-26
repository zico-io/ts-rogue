import { eveChannel } from "eve/channels/eve";
import { localDev, oidc, placeholderAuth, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    vercelOidc(),

    oidc({
      issuer: "https://token.actions.githubusercontent.com",
      audiences: ["eve-ralph-eval"],
      claims: { repository: ["zico-io/ts-rogue"] },
    }),

    localDev(),

    placeholderAuth(),
  ],
});
