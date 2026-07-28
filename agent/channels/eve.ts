import { localDev, oidc, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

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
