/* ---------------------------------------------------------------
   Budapest 2026 — configuration

   TOKEN
   -----
   Leave `token` empty and the site still works completely: everyone
   sees the seeded votes and their own picks are kept on their phone,
   with a clipboard copy so they can paste them in the group chat.

   Fill `token` in and submissions sync for real: the page fires a
   repository_dispatch, the Action in .github/workflows/collect.yml
   validates the name against the four-person whitelist and commits
   the vote to votes/all.json.

   Make the token at github.com/settings/personal-access-tokens/new
     · Fine-grained, "Only select repositories" → this repo only
     · Repository permissions → Contents: Read and write
     · Expiration: 30 days (i.e. gone shortly after the trip)

   It sits in a public file. That is the trade-off, and it is only
   acceptable because the token can touch nothing but this one
   throwaway repo. Revoke it when you get home.
   --------------------------------------------------------------- */

window.BP_CONFIG = {
  repo: "JaRze07/budapest-2026",
  branch: "main",
  token: "",
  votesPath: "votes/all.json",
  names: ["Areeb", "Nhi", "Phuong", "Jacek"]
};
