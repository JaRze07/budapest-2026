/* ---------------------------------------------------------------
   Budapest 2026 — configuration

   Votes live in a Firebase Realtime Database. There is no secret here
   and none is needed: the database is public-read, and writes are
   constrained by server-side rules (see database.rules.json) to the
   four names below, to the exact shape {ids, when}, create-only for
   custom options, and no deletes. The worst anyone who finds this URL
   can do is cast a vote — which is exactly what the name gate lets
   them do anyway.

   If the database is ever unreachable the page falls back to the
   snapshot in votes/all.json plus whatever is stored on the phone,
   so it never comes up blank.
   --------------------------------------------------------------- */

window.BP_CONFIG = {
  db: "https://budapest-2026-trip-default-rtdb.europe-west1.firebasedatabase.app",
  fallbackVotes: "votes/all.json",
  names: ["Areeb", "Nhi", "Phuong", "Jacek"]
};
