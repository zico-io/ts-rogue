import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Plays ts-rogue like a user against a named branch: checks it out, drives the terminal UI (scripts/play.sh) and/or the web UI (scripts/play-web.mjs), reproduces the scenario each acceptance criterion names, and returns a pass/fail/inconclusive verdict per criterion with screenshot or terminal-frame evidence embedded in its response. Never fixes anything - verification and evidence capture only. Give it a branch name, the acceptance criteria to check, and which surface(s) to drive.",
  // Judging rendered output (is this screen actually right, does this look
  // off) needs real visual reasoning, not just following a script - the same
  // reason the root itself runs on a strong model.
  model: "anthropic/claude-sonnet-5",
});
