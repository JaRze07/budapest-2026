/* Budapest 2026 — storage layer.

   Votes live in a Firebase Realtime Database, read and written over plain
   REST. No SDK, no key, no build step. A Server-Sent Events stream keeps
   every open page in sync, so a vote cast on someone's phone shows up on
   everyone else's screen straight away.

   If the network is down, writes are kept on the phone and replayed on the
   next successful load, and the bundled snapshot stands in for the read. */

window.BP = window.BP || {};

BP.store = (function () {
  var CFG = window.BP_CONFIG;
  var LS_ME = "bp26.me";
  var LS_PENDING = "bp26.pending";

  var state = { picks: {}, vetoes: {}, stay: {}, hype: {}, files: {}, assign: {}, final: {}, expenses: {}, plan: {}, alt: {}, ord: {}, customs: [] };
  var online = false;
  var listeners = [];
  var es = null;

  /* ---------- local storage ---------- */

  function lsGet(k, fallback) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- shape ---------- */

  function normalise(raw) {
    var s = { picks: {}, vetoes: {}, stay: {}, hype: {}, files: {}, assign: {}, final: {}, expenses: {}, plan: {}, alt: {}, ord: {}, customs: [] };
    if (!raw || typeof raw !== "object") return s;
    s.picks = raw.picks || {};
    s.vetoes = raw.vetoes || {};
    s.stay = raw.stay || {};
    s.hype = raw.hype || {};
    s.files = raw.files || {};
    s.assign = raw.assign || {};
    s.final = raw.final || {};
    s.expenses = raw.expenses || {};
    s.plan = raw.plan || {};
    s.alt = raw.alt || {};
    s.ord = raw.ord || {};
    // Customs are an object keyed by id in the database, an array in the file.
    var c = raw.customs;
    s.customs = Array.isArray(c) ? c.slice()
      : (c && typeof c === "object") ? Object.keys(c).map(function (k) { return c[k]; })
      : [];
    return s;
  }

  /* ---------- pending writes (this phone, not yet accepted by the server) ---------- */

  function pending() { return lsGet(LS_PENDING, {}); }

  function setPending(kind, name, record) {
    var p = pending();
    p[kind] = p[kind] || {};
    p[kind][name] = record;
    lsSet(LS_PENDING, p);
  }
  function clearPending(kind, name) {
    var p = pending();
    if (p[kind]) { delete p[kind][name]; lsSet(LS_PENDING, p); }
  }

  /** Anything still pending locally wins over what came back from the server. */
  function overlay(s) {
    var p = pending();
    ["picks", "vetoes", "stay", "hype", "final"].forEach(function (kind) {
      var group = p[kind] || {};
      Object.keys(group).forEach(function (name) {
        var mine = group[name], theirs = s[kind][name];
        if (theirs && String(theirs.when || "") >= String(mine.when || "")) clearPending(kind, name);
        else s[kind][name] = mine;
      });
    });
    (p.customs || []).forEach(function (c) {
      if (!s.customs.some(function (x) { return x.id === c.id; })) s.customs.push(c);
    });
    return s;
  }

  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }

  /* ---------- reading ---------- */

  async function load() {
    var raw = null;
    try {
      var r = await fetch(CFG.db + "/.json", { cache: "no-store" });
      if (r.ok) { raw = await r.json(); online = true; }
    } catch (e) { /* offline */ }

    if (!online) {
      try {
        var f = await fetch(CFG.fallbackVotes + "?t=" + Date.now(), { cache: "no-store" });
        if (f.ok) raw = await f.json();
      } catch (e) { /* nothing to show but local */ }
    }

    state = overlay(normalise(raw));
    if (online) replayPending();
    return state;
  }

  /** Push anything that failed to send last time. */
  function replayPending() {
    var p = pending();
    ["picks", "vetoes", "stay", "hype", "final"].forEach(function (kind) {
      Object.keys(p[kind] || {}).forEach(function (name) {
        put(kind + "/" + name, p[kind][name]).then(function (ok) {
          if (ok) { clearPending(kind, name); }
        });
      });
    });
    (p.customs || []).forEach(function (c) {
      put("customs/" + c.id, c).then(function (ok) {
        if (!ok) return;
        var q = pending();
        q.customs = (q.customs || []).filter(function (x) { return x.id !== c.id; });
        lsSet(LS_PENDING, q);
      });
    });
  }

  /* ---------- live updates ---------- */

  function setPath(path, data) {
    var parts = path.split("/").filter(Boolean);
    if (!parts.length) { state = overlay(normalise(data)); return; }
    var raw = { picks: state.picks, vetoes: state.vetoes, stay: state.stay, hype: state.hype, files: state.files, assign: state.assign, final: state.final, expenses: state.expenses, plan: state.plan, alt: state.alt, ord: state.ord, customs: {} };
    state.customs.forEach(function (c) { raw.customs[c.id] = c; });
    var node = raw;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    var last = parts[parts.length - 1];
    if (data === null) delete node[last]; else node[last] = data;
    state = overlay(normalise(raw));
  }

  function listen() {
    if (!window.EventSource || !online) return;
    try {
      es = new EventSource(CFG.db + "/.json");
      var handle = function (e) {
        try {
          var msg = JSON.parse(e.data);
          setPath(msg.path || "/", msg.data);
          emit();
        } catch (err) { /* keepalives and nulls */ }
      };
      es.addEventListener("put", handle);
      es.addEventListener("patch", handle);
      es.onerror = function () { /* EventSource reconnects on its own */ };
    } catch (e) { /* streaming unavailable; the page still works */ }
  }

  /* ---------- writing ---------- */

  async function put(path, body) {
    try {
      var r = await fetch(CFG.db + "/" + path + ".json", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return r.ok;
    } catch (e) { return false; }
  }

  /**
   * Lands locally first so the UI never lies about what you chose, then goes
   * to the server. kind is "picks" | "stay" | "hype"; the record shape differs
   * per kind and is validated server-side by database.rules.json.
   */
  async function saveRecord(kind, name, fields) {
    var record = Object.assign({}, fields, { when: new Date().toISOString() });
    state[kind][name] = record;
    setPending(kind, name, record);

    var ok = await put(kind + "/" + name, record);
    if (ok) clearPending(kind, name);
    return { synced: ok };
  }

  /* Shared files are data URLs in the database — no file hosting, no build
     step, and they reach everyone the moment they land. */
  async function saveFile(rec) {
    state.files[rec.id] = rec;
    var ok = await put("files/" + rec.id, {
      data: rec.data, name: rec.name, by: rec.by, when: rec.when
    });
    return { synced: ok };
  }

  async function deleteFile(id) {
    delete state.files[id];
    try {
      var r = await fetch(CFG.db + "/files/" + id + ".json", { method: "DELETE" });
      return { synced: r.ok };
    } catch (e) { return { synced: false }; }
  }

  /** Point one of the before/after slots at an uploaded file. */
  async function assignSlot(slot, fileId) {
    state.assign[slot] = fileId;
    var ok = await put("assign/" + slot, fileId);
    return { synced: ok };
  }

  /* Expenses are keyed by id like files are, so the id is carried onto the
     object when reading rather than stored twice. */
  async function saveExpense(rec) {
    var id = rec.id;
    var body = {
      title: rec.title, amount: rec.amount, currency: rec.currency || "EUR",
      paidBy: rec.paidBy, date: rec.date || "", mode: rec.mode,
      by: rec.by || {}, note: rec.note || "", when: new Date().toISOString()
    };
    state.expenses[id] = Object.assign({ id: id }, body);
    var ok = await put("expenses/" + id, body);
    return { synced: ok };
  }

  /** One slot per activity; a slot holds as many as you like. "" clears it. */
  async function savePlan(activityId, slotId) {
    state.plan[activityId] = slotId || "";
    var ok = await put("plan/" + activityId, slotId || "");
    return { synced: ok };
  }

  /** Group one activity under another as an alternative. "" makes it stand alone. */
  async function saveAlt(activityId, anchorId) {
    state.alt[activityId] = anchorId || "";
    var ok = await put("alt/" + activityId, anchorId || "");
    return { synced: ok };
  }

  /** Where an activity sits inside its band. Lower sorts first. */
  async function saveOrd(activityId, n) {
    state.ord[activityId] = n;
    var ok = await put("ord/" + activityId, n);
    return { synced: ok };
  }

  async function deleteExpense(id) {
    delete state.expenses[id];
    try {
      var r = await fetch(CFG.db + "/expenses/" + id + ".json", { method: "DELETE" });
      return { synced: r.ok };
    } catch (e) { return { synced: false }; }
  }

  function saveVote(kind, name, ids) {
    return saveRecord(kind, name, { ids: ids.slice() });
  }
  /** r: { optionId: "yes" | "ok" | "no" } */
  function saveStay(name, r) {
    return saveRecord("stay", name, { r: r });
  }
  /** One final choice each. An empty id means they have unpicked. */
  function saveFinal(name, id) {
    return saveRecord("final", name, { id: id || "" });
  }
  /** level: index into TRIP.hype.levels */
  function saveHype(name, level) {
    return saveRecord("hype", name, { level: level });
  }

  async function addCustom(item) {
    state.customs.push(item);
    var p = pending();
    p.customs = (p.customs || []).concat([item]);
    lsSet(LS_PENDING, p);

    var ok = await put("customs/" + item.id, item);
    if (ok) {
      var q = pending();
      q.customs = (q.customs || []).filter(function (x) { return x.id !== item.id; });
      lsSet(LS_PENDING, q);
    }
    return { synced: ok };
  }

  return {
    get state() { return state; },
    get live() { return online; },
    load: load,
    listen: listen,
    onChange: function (fn) { listeners.push(fn); },
    saveVote: saveVote,
    saveStay: saveStay,
    saveFile: saveFile,
    deleteFile: deleteFile,
    assignSlot: assignSlot,
    saveHype: saveHype,
    saveFinal: saveFinal,
    saveExpense: saveExpense,
    savePlan: savePlan,
    saveAlt: saveAlt,
    saveOrd: saveOrd,
    deleteExpense: deleteExpense,
    addCustom: addCustom,
    me: function () { return lsGet(LS_ME, null); },
    setMe: function (n) { lsSet(LS_ME, n); },
    clearMe: function () { try { localStorage.removeItem(LS_ME); } catch (e) {} }
  };
})();
