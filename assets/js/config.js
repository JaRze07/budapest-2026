/* ---------------------------------------------------------------
   Budapest 2026 — configuration

   VOTES
   -----
   Everything shared lives in a Firebase Realtime Database. There is no
   secret for it and none is needed: the database is public-read, and
   writes are constrained by server-side rules (database.rules.json) to
   the four names below and to exact record shapes.

   PASSWORDS
   ---------
   Plain text, on purpose — these only stop the four of us wandering into
   each other's page. Be clear-eyed about what that means: this file is
   served to the browser, so anyone who opens developer tools, or finds
   the repo, can read them. They are a doorknob, not a lock. Don't reuse
   them anywhere that matters.

   PUSH NOTIFICATIONS
   ------------------
   Removed. Real Web Push needs a server to sign and send: Chrome/Edge
   (FCM) and Apple both refuse browser-origin sends, so only Firefox
   would ever have worked. Checked, not assumed.
   --------------------------------------------------------------- */

window.BP_CONFIG = {
  db: "https://budapest-2026-trip-default-rtdb.europe-west1.firebasedatabase.app",
  fallbackVotes: "votes/all.json",
  names: ["Areeb", "Nhi", "Phuong", "Jacek"],

  passwords: {
    Areeb: "gbs69",
    Nhi: "unhicum69",
    Phuong: "png69",
    Jacek: "jrs69"
  },

  /** Who may upload the photos in the Info tab. */
  uploader: "Jacek"
};
