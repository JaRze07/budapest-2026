/* Budapest 2026 — storage layer.

   Reads the shared vote file straight from GitHub. Writes go through a
   repository_dispatch when a token is configured, and fall back to
   this-phone-only storage plus a clipboard copy when it isn't. */

window.BP = window.BP || {};

BP.store = (function () {
  var CFG = window.BP_CONFIG;
  var LS_ME = "bp26.me";
  var LS_PENDING = "bp26.pending";

  var state = { picks: {}, stay: {}, customs: [] };
  var synced = false;

  /* ---------- local helpers ---------- */

  function lsGet(k, fallback) {
    try {
      var v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  function b64utf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function emptyState() { return { picks: {}, stay: {}, customs: [] }; }

  function normalise(raw) {
    var s = emptyState();
    if (!raw || typeof raw !== "object") return s;
    // Tolerate the old flat shape ({ "Jacek": {ids:[]}, ... }) from the prototype.
    if (!raw.picks && !raw.stay && !raw.customs) {
      Object.keys(raw).forEach(function (n) {
        if (raw[n] && raw[n].ids) s.picks[n] = raw[n];
      });
      return s;
    }
    s.picks = raw.picks || {};
    s.stay = raw.stay || {};
    s.customs = Array.isArray(raw.customs) ? raw.customs : [];
    return s;
  }

  /* ---------- pending (this phone, not yet confirmed on GitHub) ---------- */

  function pending() { return lsGet(LS_PENDING, {}); }

  function setPending(kind, name, record) {
    var p = pending();
    p[kind] = p[kind] || {};
    p[kind][name] = record;
    lsSet(LS_PENDING, p);
  }

  function clearPending(kind, name, when) {
    var p = pending();
    if (p[kind] && p[kind][name] && p[kind][name].when === when) {
      delete p[kind][name];
      lsSet(LS_PENDING, p);
    }
  }

  /** Local records win over the fetched file — they're either newer or identical. */
  function overlay(s) {
    var p = pending();
    ["picks", "stay"].forEach(function (kind) {
      var group = p[kind] || {};
      Object.keys(group).forEach(function (name) {
        var mine = group[name], theirs = s[kind][name];
        if (!theirs || String(theirs.when || "") <= String(mine.when || "")) {
          s[kind][name] = mine;
        } else {
          clearPending(kind, name, mine.when);
        }
      });
    });
    (p.customs || []).forEach(function (c) {
      if (!s.customs.some(function (x) { return x.id === c.id; })) s.customs.push(c);
    });
    return s;
  }

  /* ---------- reading ---------- */

  function apiUrl() {
    return "https://api.github.com/repos/" + CFG.repo + "/contents/" +
           CFG.votesPath + "?ref=" + encodeURIComponent(CFG.branch);
  }
  function rawUrl() {
    return "https://raw.githubusercontent.com/" + CFG.repo + "/" + CFG.branch + "/" +
           CFG.votesPath + "?t=" + Date.now();
  }

  async function fetchRemote() {
    // 1. Authenticated Contents API — always fresh, no CDN lag.
    if (CFG.token) {
      try {
        var r = await fetch(apiUrl(), {
          headers: {
            Authorization: "Bearer " + CFG.token,
            Accept: "application/vnd.github+json"
          },
          cache: "no-store"
        });
        if (r.ok) {
          var j = await r.json();
          return JSON.parse(b64utf8(j.content));
        }
      } catch (e) { /* fall through */ }
    }
    // 2. raw.githubusercontent — public, cache-busted.
    try {
      var r2 = await fetch(rawUrl(), { cache: "no-store" });
      if (r2.ok) return await r2.json();
    } catch (e) { /* fall through */ }
    // 3. The copy shipped with the page — works offline and on localhost.
    try {
      var r3 = await fetch(CFG.votesPath + "?t=" + Date.now(), { cache: "no-store" });
      if (r3.ok) return await r3.json();
    } catch (e) { /* fall through */ }
    return null;
  }

  async function load() {
    var raw = await fetchRemote();
    synced = raw !== null;
    state = overlay(normalise(raw));
    return state;
  }

  /* ---------- writing ---------- */

  async function dispatch(payload) {
    if (!CFG.token) return false;
    var r = await fetch("https://api.github.com/repos/" + CFG.repo + "/dispatches", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + CFG.token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ event_type: "vote", client_payload: payload })
    });
    if (!r.ok) throw new Error("dispatch " + r.status);
    return true;
  }

  /**
   * Save a vote. Always lands locally first so the UI never lies about
   * what you picked; then tries to sync.
   * kind: "picks" | "stay"
   * Resolves { synced: bool, reason?: string }
   */
  async function saveVote(kind, name, ids, labels) {
    var record = { ids: ids.slice(), when: new Date().toISOString() };
    setPending(kind, name, record);
    state[kind][name] = record;

    try {
      var ok = await dispatch({ kind: kind, name: name, ids: ids, picks: labels || [], when: record.when });
      return { synced: ok, reason: ok ? null : "no-token" };
    } catch (e) {
      return { synced: false, reason: "failed" };
    }
  }

  async function addCustom(item) {
    var p = pending();
    p.customs = p.customs || [];
    p.customs.push(item);
    lsSet(LS_PENDING, p);
    state.customs.push(item);
    try {
      var ok = await dispatch({ kind: "custom", name: item.by, custom: item, when: item.when });
      return { synced: ok };
    } catch (e) {
      return { synced: false };
    }
  }

  /** After a dispatch the Action needs ~30 s. Poll until the file catches up. */
  function watchFor(kind, name, when, onLanded) {
    var tries = 0;
    var t = setInterval(async function () {
      tries++;
      if (tries > 14) { clearInterval(t); return; }
      var raw = await fetchRemote();
      var s = normalise(raw);
      var rec = s[kind] && s[kind][name];
      if (rec && String(rec.when) === String(when)) {
        clearInterval(t);
        clearPending(kind, name, when);
        state = overlay(s);
        if (onLanded) onLanded(state);
      }
    }, 5000);
    return function () { clearInterval(t); };
  }

  return {
    get state() { return state; },
    get synced() { return synced; },
    get live() { return !!CFG.token; },
    load: load,
    saveVote: saveVote,
    addCustom: addCustom,
    watchFor: watchFor,
    me: function () { return lsGet(LS_ME, null); },
    setMe: function (n) { lsSet(LS_ME, n); },
    clearMe: function () { try { localStorage.removeItem(LS_ME); } catch (e) {} }
  };
})();
