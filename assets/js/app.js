/* Budapest 2026 — views and interaction. */

/* Venues without a photo fall back to a lettered tile. Global because it's an
   inline onerror — the image can fail before any listener is attached. */
window.BPnoPhoto = function (img, letter) {
  var tile = document.createElement("div");
  tile.className = "ctile";
  tile.textContent = letter || "?";
  var card = img.closest(".card");
  img.replaceWith(tile);
  // The "photo illustrative" note is meaningless when there's no photo at all.
  var area = card && card.querySelector(".area");
  if (area) area.textContent = area.textContent.replace(" · photo illustrative", "");
};

/* A photo that isn't in the repo yet shows as a labelled placeholder rather
   than a broken-image icon. */
window.BPmissing = function (img, label) {
  var box = document.createElement("div");
  box.className = "tmissing";
  box.textContent = label + " — photo not added yet";
  img.replaceWith(box);
};

(function () {
  "use strict";

  var CFG = window.BP_CONFIG;
  var store = BP.store;

  var VENUES = null;   // data/venues.json
  var TRIP = null;     // data/trip.json
  var me = null;
  var view = "home";
  var showResults = false;
  var sel = { picks: {}, stay: {} };
  var byId = {};       // venue id -> {item, catIndex}

  /* ================= tiny helpers ================= */

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toast(msg, ms) {
    var t = el("toast");
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.display = "none"; }, ms || 3400);
  }
  function person(name) {
    return (TRIP.people || []).filter(function (p) { return p.name === name; })[0] || null;
  }

  /* The header is a compact bar on a phone and a taller bar with tabs on a
     desktop. Measure it rather than guess, so sticky category headers always
     dock right underneath. */
  function syncTopbar() {
    var h = document.querySelector("header.top");
    if (h) document.documentElement.style.setProperty("--topbar", h.offsetHeight + "px");
  }

  /** Whichever option won the vote — or null while nowhere is decided. */
  function ourPlace() {
    var id = TRIP.stay.chosen;
    if (!id) return null;
    return TRIP.stay.vote.options.filter(function (o) { return o.id === id; })[0] || null;
  }

  /* Uber publishes a universal link that takes both ends of the journey; Bolt
     publishes nothing equivalent and says so outright, so Bolt gets the address
     on the clipboard instead — one paste into its destination box.
     `from` null means "wherever I'm standing". */
  function rideTo(to, from) {
    var pickup = from
      ? "&pickup%5Blatitude%5D=" + from.lat +
        "&pickup%5Blongitude%5D=" + from.lng +
        "&pickup%5Bnickname%5D=" + encodeURIComponent(from.name || "Our place")
      : "";
    var uber = "https://m.uber.com/ul/?action=setPickup" +
      (from ? "" : "&pickup=my_location") + pickup +
      "&dropoff%5Blatitude%5D=" + to.lat +
      "&dropoff%5Blongitude%5D=" + to.lng +
      "&dropoff%5Bnickname%5D=" + encodeURIComponent(to.name) +
      (to.addr ? "&dropoff%5Bformatted_address%5D=" + encodeURIComponent(to.addr) : "");
    // Omitting origin lets Maps start from wherever the phone is.
    var maps = "https://www.google.com/maps/dir/?api=1" +
      (from ? "&origin=" + from.lat + "," + from.lng : "") +
      "&destination=" + to.lat + "," + to.lng + "&travelmode=transit";
    return { uber: uber, maps: maps };
  }

  function pt(o) {
    return { lat: o.lat, lng: o.lng, name: o.name, addr: o.full_address || (o.area + ", Budapest") };
  }

  function ticketBlock(key) {
    var t = (TRIP.tickets || {})[key];
    if (!t) return "";
    return '<div class="tick"><b>' + esc(t.name) + " · " + esc(t.price) + "</b><span>" +
      esc(t.where) + "</span></div>";
  }

  /** Two ways to reach anything: from where we sleep, and from wherever you are. */
  function openSheet(id) {
    var src = byId[id] ? byId[id].item
            : store.state.customs.filter(function (c) { return c.id === id; })[0]
            || TRIP.stay.vote.options.filter(function (o) { return o.id === id; })[0];
    if (!src || !src.lat) return;

    var to = pt(src);
    var place = ourPlace();
    var html = '<div class="kick">Getting there</div>' +
      "<h3>" + esc(src.name) + "</h3>" +
      '<div class="sheetarea">' + esc(src.area || "") + "</div>";

    if (place && place.id !== src.id) {
      html += fromBlock("From our place", place.name, to, pt(place));
    } else if (!place) {
      html += '<div class="fromnote">There\'s no <b>from our place</b> yet — nowhere is booked. ' +
        "It appears here the moment the accommodation vote is settled.</div>";
    }
    html += fromBlock("From where I am now", "", to, null);

    html += '<div class="rides">' +
      '<button type="button" class="ride" data-copy="' + esc(to.addr) + '">Copy address for Bolt</button>' +
      '<span class="ridenote">Bolt publishes no link that carries a destination — paste the address ' +
      "into its own box.</span></div>";

    html += '<div class="sheettickets"><div class="kick">Tickets, if you take transit</div>' +
      ticketBlock("single") + ticketBlock("travelcard") + "</div>";

    el("sheetBody").innerHTML = html;
    el("sheet").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    el("sheet").hidden = true;
    document.body.style.overflow = "";
  }

  /** One labelled origin block inside the Get-there sheet. */
  function fromBlock(title, sub, to, from) {
    var r = rideTo(to, from);
    return '<div class="fromblock">' +
      '<div class="fromhead">' + esc(title) + (sub ? " <span>" + esc(sub) + "</span>" : "") + "</div>" +
      '<div class="rides">' +
        '<a class="ride go" href="' + r.uber + '" target="_blank" rel="noopener">Uber</a>' +
        '<a class="ride" href="' + r.maps + '" target="_blank" rel="noopener">Transit &amp; walking</a>' +
      "</div></div>";
  }

  /* ================= photo uploads ================= */

  /* Two slots, Jacek only. Files are shrunk in a canvas and stored as data
     URLs in the database, so there's no file hosting and no build step —
     and they appear on Nhi's home screen the moment they land. */
  function renderUpload() {
    var T = TRIP.transformation, box = el("infoUpload");
    if (!box) return;
    if (!T || !T.slots || me !== CFG.uploader) { box.innerHTML = ""; return; }

    box.innerHTML =
      '<div class="sec-title">Nhi\'s before and after</div>' +
      '<p class="sec-note">Only you can see this. Drop a photo into each slot — it goes ' +
      "straight onto her home screen. Re-drop to replace.</p>" +
      '<div class="drops">' + T.slots.map(function (s) {
        var has = store.state.photos[s.key];
        return '<label class="drop" data-slot="' + esc(s.key) + '">' +
          '<input type="file" accept="image/*" data-slotinput="' + esc(s.key) + '" hidden>' +
          (has ? '<img src="' + esc(has) + '" alt="">' : '<span class="dropicon">+</span>') +
          '<span class="droplabel">' + esc(s.label) + "</span>" +
          '<span class="dropstate">' + (has ? "Tap to replace" : "Tap or drop a photo") + "</span>" +
        "</label>";
      }).join("") + "</div>";
  }

  /** Shrink to something a database row can hold without complaint. */
  function shrink(file, maxPx, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("read")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("decode")); };
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxPx / Math.max(w, h));
          var c = document.createElement("canvas");
          c.width = Math.round(w * scale);
          c.height = Math.round(h * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function acceptPhoto(slot, file) {
    if (!file || !/^image\//.test(file.type)) { toast("That's not an image."); return; }
    toast("Processing…", 8000);
    var url;
    try {
      url = await shrink(file, 900, 0.82);
      // The database caps the row; drop quality until it fits rather than failing.
      var q = 0.82;
      while (url.length > 650000 && q > 0.4) { q -= 0.12; url = await shrink(file, 900, q); }
      if (url.length > 650000) url = await shrink(file, 640, 0.6);
    } catch (e) { toast("Couldn't read that file."); return; }

    var res = await store.savePhoto(slot, url);
    renderUpload();
    renderTransformation();
    toast(res.synced
      ? "Uploaded — it's on her home screen now."
      : "Couldn't upload. Check you're online and try again.", 4000);
  }

  /* ================= the apps you need ================= */

  function renderApps() {
    var apps = TRIP.apps || [];
    if (!apps.length) { el("infoApps").innerHTML = ""; return; }
    el("infoApps").innerHTML = apps.map(function (a) {
      return '<div class="app' + (a.required ? " req" : "") + '">' +
        '<div class="apphead"><b>' + esc(a.name) + "</b><span>" + esc(a.by) + "</span>" +
          (a.required ? '<em class="appreq">Install before you fly</em>' : "") + "</div>" +
        "<p>" + esc(a.what) + "</p>" +
        '<div class="applinks">' +
          '<a class="ride go" href="' + esc(a.ios) + '" target="_blank" rel="noopener">App Store</a>' +
          '<a class="ride" href="' + esc(a.android) + '" target="_blank" rel="noopener">Google Play</a>' +
        "</div></div>";
    }).join("");
  }

  /* --- clock maths, all in Budapest local time --- */
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  function fmtMin(mins) {
    var d = 0;
    while (mins >= 1440) { mins -= 1440; d++; }
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + (d ? " +" + d + "d" : "");
  }
  function dur(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h ? h + " h " : "") + (m ? m + " min" : (h ? "" : "0 min"));
  }
  function dayName(iso) {
    var d = new Date(iso + "T12:00:00+02:00");
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  }
  function dayLong(iso) {
    var d = new Date(iso + "T12:00:00+02:00");
    var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return days[d.getUTCDay()] + " " + d.getUTCDate() + " " + mons[d.getUTCMonth()];
  }

  /** The arriving leg of someone's outbound flight, or null. */
  function arrival(p) {
    if (!p || !p.flights) return null;
    var out = p.flights.filter(function (f) { return f.dir === "out"; })[0];
    if (!out || !out.legs || !out.legs.length) return null;
    var last = out.legs[out.legs.length - 1];
    return { date: out.date, time: last.arr, from: last.from_city, min: toMin(last.arr) };
  }
  function departure(p) {
    if (!p || !p.flights) return null;
    var back = p.flights.filter(function (f) { return f.dir === "back"; })[0];
    if (!back || !back.legs || !back.legs.length) return null;
    var first = back.legs[0];
    return { date: back.date, time: first.dep, to: back.legs[back.legs.length - 1].to_city, min: toMin(first.dep) };
  }

  /* ================= boot ================= */

  async function boot() {
    try {
      var res = await Promise.all([
        fetch("data/venues.json?v=2").then(function (r) { return r.json(); }),
        fetch("data/trip.json?v=2").then(function (r) { return r.json(); })
      ]);
      VENUES = res[0];
      TRIP = res[1];
    } catch (e) {
      document.body.innerHTML =
        '<div style="padding:40px;font-family:Georgia,serif">Could not load the trip data. ' +
        'If you opened this file directly, run it through a web server instead.</div>';
      return;
    }

    (VENUES.categories || []).forEach(function (c, ci) {
      (c.items || []).forEach(function (it) { byId[it.id] = { item: it, cat: ci }; });
    });

    wireChrome();
    await store.load();
    store.listen();
    store.onChange(onRemoteChange);

    me = store.me();
    if (me && CFG.names.indexOf(me) === -1) me = null;
    if (me) enter(me); else openGate();
  }

  function wireChrome() {
    el("names").innerHTML = CFG.names.map(function (n) {
      var p = person(n);
      var sub = !p ? "" :
        p.status === "unconfirmed" ? "not confirmed" :
        p.flight_status === "confirmed" ? "flight in" : "flight pending";
      var cls = (p && p.status === "unconfirmed") ? " class=\"tentative\"" : "";
      return '<button type="button"' + cls + ' data-name="' + esc(n) + '">' + esc(n) +
             (sub ? "<small>" + esc(sub) + "</small>" : "") + "</button>";
    }).join("");

    el("names").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-name]");
      if (b) askPassword(b.getAttribute("data-name"));
    });

    el("pwBack").addEventListener("click", backToNames);
    el("pwBox").addEventListener("submit", function (e) {
      e.preventDefault();
      tryPassword();
    });

    el("swapBtn").addEventListener("click", function () {
      store.clearMe();
      me = null;
      sel = { picks: {}, stay: {} };
      openGate();
    });

    el("tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-view]");
      if (b) go(b.getAttribute("data-view"));
    });

    el("toggleResults").addEventListener("click", function () {
      showResults = !showResults;
      this.textContent = showResults ? "Hide who picked what" : "Show who picked what";
      paintWho();
      renderSummary();
    });

    el("sendBtn").addEventListener("click", submit);

    // Delegated once — the containers persist, only their innerHTML changes.
    el("cats").addEventListener("click", onBoardClick);
    // Accommodation cards aren't click-to-toggle any more — the three rating
    // buttons are handled by the document-level delegate.

    // Only one Info panel open at a time — `toggle` doesn't bubble, so capture.
    document.addEventListener("toggle", function (e) {
      var d = e.target;
      if (!d.matches || !d.matches("#infoBody details") || !d.open) return;
      Array.prototype.forEach.call(document.querySelectorAll("#infoBody details"), function (o) {
        if (o !== d) o.open = false;
      });
    }, true);

    // File picker, plus real drag-and-drop onto either slot.
    document.addEventListener("change", function (e) {
      var inp = e.target.closest("[data-slotinput]");
      if (inp && inp.files && inp.files[0]) {
        acceptPhoto(inp.getAttribute("data-slotinput"), inp.files[0]);
        inp.value = "";
      }
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        var d = e.target.closest && e.target.closest(".drop");
        if (!d) return;
        e.preventDefault();
        d.classList.add("over");
      });
    });
    document.addEventListener("dragleave", function (e) {
      var d = e.target.closest && e.target.closest(".drop");
      if (d) d.classList.remove("over");
    });
    document.addEventListener("drop", function (e) {
      var d = e.target.closest && e.target.closest(".drop");
      if (!d) return;
      e.preventDefault();
      d.classList.remove("over");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) acceptPhoto(d.getAttribute("data-slot"), f);
    });

    document.addEventListener("click", function (e) {
      var hy = e.target.closest("[data-hype]");
      if (hy) { setHype(+hy.getAttribute("data-hype")); return; }

      var sr = e.target.closest("[data-rate]");
      if (sr) { setStay(sr.getAttribute("data-opt"), sr.getAttribute("data-rate")); return; }

      var jump = e.target.closest("[data-jump]");
      if (jump) { scrollToCard(jump.getAttribute("data-jump")); return; }

      var g = e.target.closest("[data-goto]");
      if (g) { openSheet(g.getAttribute("data-goto")); return; }

      if (e.target.closest("#sheetClose") || e.target.id === "sheet") { closeSheet(); return; }

      var b = e.target.closest("[data-copy]");
      if (!b) return;
      var text = b.getAttribute("data-copy");
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(function () { toast("Copied — paste it into Bolt."); })
        .catch(function () { toast(text); });
    });

    window.addEventListener("hashchange", function () {
      var v = (location.hash || "").replace("#/", "");
      if (v && v !== view) go(v, true);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el("sheet").hidden) closeSheet();
    });

    syncTopbar();
    window.addEventListener("resize", syncTopbar);
  }

  function openGate() {
    el("gate").hidden = false;
    el("topName").textContent = "—";
    backToNames();
  }

  /* A doorknob, not a lock — enough that nobody wanders into someone else's
     page by accident. The passwords are in config.js in the clear. */
  var pending_name = null;

  function backToNames() {
    pending_name = null;
    el("pwBox").hidden = true;
    el("names").hidden = false;
    el("gateHint").hidden = false;
    el("pwErr").hidden = true;
    el("pwInput").value = "";
  }

  function askPassword(name) {
    if (CFG.names.indexOf(name) === -1) return;
    if (!CFG.passwords || !CFG.passwords[name]) { enter(name); return; }
    pending_name = name;
    el("names").hidden = true;
    el("gateHint").hidden = true;
    el("pwBox").hidden = false;
    el("pwName").textContent = name;
    el("pwErr").hidden = true;
    el("pwInput").value = "";
    el("pwInput").focus();
  }

  function tryPassword() {
    if (!pending_name) return;
    var given = el("pwInput").value.trim();
    if (given === CFG.passwords[pending_name]) {
      var name = pending_name;
      backToNames();
      enter(name);
    } else {
      el("pwErr").hidden = false;
      el("pwInput").value = "";
      el("pwInput").focus();
    }
  }

  function enter(name) {
    me = name;
    store.setMe(name);
    el("gate").hidden = true;
    el("topName").textContent = name;
    el("topDays").textContent = "28–31 Aug";

    // Pre-tick whatever this person already has on record.
    sel = { picks: {}, stay: {} };
    var pk = store.state.picks[name];
    if (pk && pk.ids) pk.ids.forEach(function (id) { sel.picks[id] = true; });
    var st = store.state.stay[name];
    if (st && st.r) Object.keys(st.r).forEach(function (id) { sel.stay[id] = st.r[id]; });

    renderAll();
    var v = (location.hash || "").replace("#/", "");
    go(CFG.names.indexOf(name) > -1 && v ? v : "home");
  }

  /** Jump from a tally row to the card itself, clearing the two sticky bars. */
  function scrollToCard(id) {
    if (view !== "picks") go("picks");
    var c = el("c-" + id);
    if (!c) return;
    var bar = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--topbar"), 10) || 51;
    var top = c.getBoundingClientRect().top + window.pageYOffset - bar - 58;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    c.classList.add("flash");
    setTimeout(function () { c.classList.remove("flash"); }, 1500);
  }

  function go(v, fromHash) {
    if (["home", "picks", "stay", "info"].indexOf(v) === -1) v = "home";
    view = v;
    // Entering Info always starts fully collapsed.
    if (v === "info") {
      Array.prototype.forEach.call(document.querySelectorAll("#infoBody details"), function (d) {
        d.open = false;
      });
    }
    ["home", "picks", "stay", "info"].forEach(function (k) {
      el("view-" + k).classList.toggle("on", k === v);
    });
    Array.prototype.forEach.call(el("tabs").children, function (b) {
      b.classList.toggle("on", b.getAttribute("data-view") === v);
    });
    if (!fromHash) location.hash = "#/" + v;
    updateBar();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderAll() {
    renderHome();
    renderPicks();
    renderStay();
    renderInfo();
    paintWho();
    renderSummary();
    updateBar();
    customCount = store.state.customs.length;
  }

  /* Somebody else voted. Repaint the shared parts without disturbing whatever
     this person is in the middle of selecting. */
  var customCount = 0;
  function onRemoteChange() {
    if (!me) return;
    if (store.state.customs.length !== customCount) {
      customCount = store.state.customs.length;
      renderPicks();
    }
    renderStay();
    renderClash();
    renderArrivals();
    renderHypeOthers();
    renderTransformation();
    renderUpload();
    // After renderStay — it rebuilds the cards, which would wipe the chips.
    paintWho();
    renderSummary();
    el("submittedLine").textContent = submittedLine();
    updateBar();
  }

  /* ================= HOME ================= */

  function renderHome() {
    renderCountdown();
    renderTransformation();
    renderYou();
    renderClash();
    renderArrivals();
    renderStaySummary();
    renderSchedule();
  }

  /* The box is built once and only the digits are rewritten each second —
     otherwise the ticker would tear down the hype panel under your finger. */
  var cdTimer = null;
  function renderCountdown() {
    el("countdown").innerHTML =
      '<div class="welcome">Welcome back, <b>' + esc(me || "") + "</b></div>" +
      '<div class="kick" id="cdKick">Wheels up in</div>' +
      '<div class="units" id="cdUnits"></div>' +
      '<div class="line" id="cdLine"></div>' +
      '<div class="hype" id="hypeBox"></div>';
    renderHype();

    var target = new Date(TRIP.trip.start + "T00:00:00" + TRIP.trip.tz_offset).getTime();
    var end = new Date(TRIP.trip.end + "T23:59:59" + TRIP.trip.tz_offset).getTime();

    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) {
        el("cdKick").textContent = Date.now() > end ? "That was" : "You are in";
        el("cdUnits").innerHTML = '<div class="nowbig">Budapest</div>';
        el("cdLine").textContent = TRIP.trip.label;
        if (cdTimer) clearInterval(cdTimer);
        return;
      }
      var s = Math.floor(diff / 1000);
      var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
          m = Math.floor(s % 3600 / 60), ss = s % 60;
      el("cdUnits").innerHTML =
        '<div class="u"><b>' + d + "</b><span>days</span></div>" +
        '<div class="u"><b>' + h + "</b><span>hrs</span></div>" +
        '<div class="u"><b>' + m + "</b><span>min</span></div>" +
        '<div class="u"><b>' + ss + "</b><span>sec</span></div>";

      var mine = me ? arrival(person(me)) : null;
      el("cdLine").textContent = mine
        ? "You land " + dayLong(mine.date) + " at " + mine.time + "."
        : "Flight not in yet — the countdown is the same for everyone.";
    }
    tick();
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = setInterval(tick, 1000);
  }

  /* ---- how excited are you ---- */

  function renderHype() {
    var H = TRIP.hype;
    if (!H || !el("hypeBox")) return;
    var mine = store.state.hype[me];
    var lvl = mine ? mine.level : null;
    el("hypeBox").innerHTML =
      '<div class="hq">' + esc(H.question) + "</div>" +
      '<div class="hopts">' + H.levels.map(function (l, i) {
        return '<button type="button" class="hopt' + (lvl === i ? " on" : "") +
          '" data-hype="' + i + '">' + esc(l) + "</button>";
      }).join("") + "</div>" +
      '<div class="hothers" id="hypeOthers"></div>';
    renderHypeOthers();
  }

  function renderHypeOthers() {
    var H = TRIP.hype, box = el("hypeOthers");
    if (!box) return;
    box.innerHTML = CFG.names.map(function (n) {
      var h = store.state.hype[n];
      var said = h && H.levels[h.level] ? H.levels[h.level] : null;
      return '<div class="hrow' + (n === me ? " mine" : "") + '">' +
        "<span>" + esc(n) + "</span>" +
        (said ? "<b>" + esc(said) + "</b>" : '<i class="pendingdash">hasn\'t said</i>') +
        "</div>";
    }).join("");
  }

  async function setHype(level) {
    if (!me) return;
    await store.saveHype(me, level);
    renderHype();
  }

  /* ---- Nhi's before and after ---- */

  function renderTransformation() {
    var T = TRIP.transformation, box = el("homeTransform");
    if (!box) return;
    if (!T || me !== T.for) { box.innerHTML = ""; return; }

    var pics = (T.slots || []).map(function (s) {
      var url = store.state.photos[s.key] || null;
      return url
        ? '<img src="' + esc(url) + '" alt="' + esc(s.label) + '">'
        : '<div class="tmissing">' + esc(s.label) + " — not uploaded yet</div>";
    });
    if (!pics.length) { box.innerHTML = ""; return; }

    box.innerHTML =
      '<div class="transform">' +
        '<div class="kick">' + esc(T.title) + "</div>" +
        '<div class="tpair">' + pics.join("") + "</div>" +
        (T.caption ? '<p class="tcap">' + esc(T.caption) + "</p>" : "") +
      "</div>";
  }

  /** Your flight, your route from the airport — or the nudge if we don't have it. */
  function renderYou() {
    var p = person(me);
    var box = el("homeYou");
    if (!p) { box.innerHTML = ""; return; }

    if (p.flight_status !== "confirmed") {
      var unconfirmed = p.status === "unconfirmed";
      box.innerHTML =
        '<div class="alert' + (unconfirmed ? " soft" : "") + '">' +
          '<div class="ahead">' +
            '<span class="abadge">' + (unconfirmed ? "Not confirmed" : "Flight missing") + "</span>" +
            "<b>" + esc(unconfirmed
              ? "You're still a maybe, " + p.name + "."
              : "We don't have your flight yet, " + p.name + ".") + "</b>" +
          "</div>" +
          "<p>" + esc(unconfirmed
            ? "Nothing's booked for you yet. Say the word and send a flight — everything below fills in the moment it's added."
            : "Send Jacek the booking screenshot and this page fills in automatically.") + "</p>" +
          '<div class="awill"><span>Once it\'s in, you\'ll see here:</span>' +
            "<ul>" +
              "<li>Your flights out and back, leg by leg</li>" +
              "<li>A door-to-door route in, timed to <em>your</em> landing</li>" +
              "<li>Your slot on the arrivals board so everyone knows when you're in</li>" +
            "</ul>" +
          "</div>" +
        "</div>" +
        airportSection(null);
      return;
    }

    var out = p.flights.filter(function (f) { return f.dir === "out"; })[0];
    var back = p.flights.filter(function (f) { return f.dir === "back"; })[0];
    var arr = arrival(p);

    box.innerHTML =
      '<div class="sec-title">Your flights</div>' +
      (out ? flightCard(out, "Out") : "") +
      (back ? flightCard(back, "Back") : "") +
      (p.note ? '<p class="sec-note">' + esc(p.note) + "</p>" : "") +
      airportSection(arr);
  }

  /** The way in from BUD — only meaningful once we know where we're going. */
  function airportSection(arr) {
    var place = ourPlace();
    if (!place) {
      return '<div class="sec-title">Getting in from the airport</div>' +
        '<div class="pending"><b>Waiting on the accommodation vote</b>' +
        "<p>The route in depends entirely on where we end up, so there's nothing honest to show yet. " +
        "The moment the vote is settled this fills in with your own timings, where to buy each ticket, " +
        "and a car straight to the front door.</p>" +
        '<a class="btn gobtn" href="#/stay">Go and vote</a></div>';
    }
    return '<div class="sec-title">Airport → ' + esc(place.name) + "</div>" +
      (arr
        ? '<p class="sec-note">You land at ' + esc(arr.time) + " on " + esc(dayLong(arr.date)) +
          ". " + esc(TRIP.airport.buffer_note) + "</p>"
        : '<p class="sec-note">Timings fill in with real clock times once your flight is in here.</p>') +
      renderRoutes(arr, place) +
      earlyNote(arr, place);
  }

  function flightCard(f, label) {
    var legs = f.legs.map(function (l) {
      return '<div class="leg">' +
        '<div class="pt"><b>' + esc(l.from) + "</b><span>" + esc(l.dep) + "</span></div>" +
        '<div class="mid"><small>' + esc(l.duration) + '</small><div class="rule"></div>' +
        '<div class="carrier">' + esc(l.carrier || "") + "</div></div>" +
        '<div class="pt"><b>' + esc(l.to) + "</b><span>" + esc(l.arr) + "</span></div>" +
      "</div>";
    }).join("");
    return '<div class="flight">' +
      '<div class="fhead"><b>' + esc(dayLong(f.date)) + "</b><span>" + esc(label) + "</span></div>" +
      legs +
      (f.connection ? '<div class="fnote">' + esc(f.connection) + "</div>" : "") +
    "</div>";
  }

  /* Routes from BUD to wherever we end up staying. The car leads — it's the one
     that works at any hour and needs no ticket. The transit options carry the
     last leg as a live Maps link, because it depends entirely on the address. */
  function renderRoutes(arr, place) {
    var A = TRIP.airport;
    var hour = arr ? arr.min / 60 : 12;
    var late = !!arr && (hour >= 22.5 || hour < 4);

    var html = late ? '<div class="callout"><b>Landing late</b><p>' + esc(A.night_note) + "</p></div>" : "";

    html += A.routes.map(function (r, i) {
      var running = fits(r, hour);
      var t = arr ? arr.min + (A.buffer_arrive || 25) : null;

      var steps = r.steps.map(function (s) {
        var clock = (t !== null)
          ? '<div class="clock">' + fmtMin(t) + "<small>+" + s.min + "m</small></div>"
          : '<div class="clock" style="font-size:12px;color:var(--slate)">' + s.min + " min</div>";
        if (t !== null) t += s.min;

        var onward = "";
        if (s.onward && place && place.lat) {
          var hub = A[s.onward];
          var live = rideTo(pt(place), { lat: hub.lat, lng: hub.lng, name: hub.name });
          onward = '<div class="onward"><a class="mini" href="' + live.maps + '" target="_blank" ' +
            'rel="noopener">Live route: ' + esc(hub.name) + " → " + esc(place.name) + "</a></div>";
        }

        return "<li>" + clock + "<div>" + esc(s.text) + onward +
          ticketBlock(s.ticket) + "</div></li>";
      }).join("");

      var lands = (t !== null && place)
        ? '<li><div class="clock">' + fmtMin(t) + '<small>arrive</small></div><div><b>At ' +
          esc(place.name) + ".</b> Roughly " + esc(dur(t - arr.min)) + " door to door from touchdown.</div></li>"
        : "";

      var rides = "";
      if (r.ride && place && place.lat) {
        var d = rideTo(pt(place), null);
        rides = '<div class="rides">' +
          '<a class="ride go" href="' + d.uber + '" target="_blank" rel="noopener">Ride with Uber</a>' +
          '<button type="button" class="ride" data-copy="' + esc(pt(place).addr) + '">Copy for Bolt</button>' +
          "</div>";
      }

      return '<div class="route' + (i === 0 ? "" : " alt") + '">' +
        '<div class="rhead"><b>' + esc(r.label) + '</b><span class="badge">' + esc(r.badge) + "</span></div>" +
        '<ul class="steps">' + steps + lands + "</ul>" +
        rides +
        '<div class="rcost">' + esc(r.cost) + "</div>" +
        (!running
          ? '<div class="rwarn"><b>Not running at that hour.</b> ' + esc(A.night_note) + "</div>"
          : (r.warning ? '<div class="rwarn">' + esc(r.warning) + "</div>" : "")) +
      "</div>";
    }).join("");

    return html;
  }
  function fits(r, hour) {
    var w = r.window || [0, 24];
    return hour >= w[0] && hour <= w[1];
  }

  /** Landing well before check-in is worth calling out. */
  function earlyNote(arr, place) {
    if (!arr || !place) return "";
    var A = TRIP.airport;
    var bus = A.routes.filter(function (r) { return r.id === "100e"; })[0] || A.routes[0];
    var there = arr.min + (A.buffer_arrive || 25) +
      bus.steps.reduce(function (n, s) { return n + s.min; }, 0);
    var checkin = 15 * 60;
    if (arr.date !== TRIP.trip.start || there > checkin - 45) return "";
    return '<div class="callout"><b>You get there before check-in</b><p>' +
      "On that route you're at " + esc(place.name) + " around " + fmtMin(there) +
      ", and check-in is usually 15:00. Ask about dropping bags early — Margaret Island is the " +
      "easiest way to kill a few hours with luggage already off your back.</p></div>";
  }

  function renderClash() {
    var c = TRIP.clash;
    if (!c) { el("homeClash").innerHTML = ""; return; }
    var tally = c.ids.map(function (id) {
      var v = byId[id];
      var voters = votersFor(id);
      return '<div class="side"><b>' + esc(v ? v.item.name : id) + "</b> — " +
        (voters.length ? esc(voters.join(", ")) : "nobody yet") + "</div>";
    }).join("");
    el("homeClash").innerHTML =
      '<div class="callout"><b>' + esc(c.title) + "</b><p>" + esc(c.body) + "</p>" +
      '<div class="tally">' + tally + "</div></div>";
  }

  function renderArrivals() {
    var people = (TRIP.people || []).slice();
    var rows = people.map(function (p) {
      var a = arrival(p), d = departure(p);
      var tm, sub;
      if (a) {
        tm = '<div class="tm"><b>' + esc(a.time) + "</b><small>" + esc(dayName(a.date)) + " · from " + esc(a.from) + "</small></div>";
        sub = d ? "out " + dayName(d.date) + " " + d.time : "";
      } else if (p.status === "unconfirmed") {
        tm = '<div class="tm tbd"><b>Maybe</b><small>no booking</small></div>';
        sub = "Not confirmed";
      } else {
        tm = '<div class="tm tbd"><b>Counting down</b><small>flight pending</small></div>';
        sub = "Flight not shared yet";
      }
      return '<div class="row' + (p.name === me ? " me-row" : "") + '">' +
        '<div class="av">' + esc(p.initial) + "</div>" +
        '<div class="nm"><b>' + esc(p.name) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>" +
        tm + "</div>";
    }).join("");

    var missing = people.filter(function (p) { return p.flight_status !== "confirmed"; })
                        .map(function (p) { return p.name; });

    el("homeArrivals").innerHTML =
      '<div class="sec-title">Who lands when</div>' +
      (missing.length
        ? '<p class="sec-note">Still waiting on ' + esc(missing.join(" and ")) +
          ". Their rows fill in the moment the flights are shared.</p>"
        : "") +
      '<div class="board">' + rows + "</div>";
  }

  function renderStaySummary() {
    var place = ourPlace();
    var voted = CFG.names.filter(function (n) { return store.state.stay[n]; });

    if (!place) {
      el("homeStay").innerHTML =
        '<div class="sec-title">Where we sleep</div>' +
        '<div class="pending"><b>Not decided</b>' +
        "<p>Five options are up. " + voted.length + " of " + CFG.names.length +
        " have voted" + (voted.length ? " — " + esc(voted.join(", ")) : "") + ".</p>" +
        '<a class="btn gobtn" href="#/stay">See the options</a></div>';
      return;
    }

    el("homeStay").innerHTML =
      '<div class="sec-title">Where we sleep</div>' +
      '<div class="board">' +
        '<div class="row"><div class="av">⌂</div><div class="nm"><b>' + esc(place.name) +
          "</b><small>" + esc(place.area) + "</small></div></div>" +
        (place.checkin ? '<div class="row"><div class="av">↓</div><div class="nm"><b>Check in</b><small>' +
          esc(place.checkin) + "</small></div></div>" : "") +
        (place.checkout ? '<div class="row"><div class="av">↑</div><div class="nm"><b>Check out</b><small>' +
          esc(place.checkout) + "</small></div></div>" : "") +
      "</div>" +
      '<div class="links"><button type="button" class="gotolink" data-goto="' + esc(place.id) +
        '">Get there</button><a href="#/stay">Details</a></div>';
  }

  function renderSchedule() {
    var html = '<div class="sec-title">The shape of it</div>' +
      '<p class="sec-note">Only the fixed points are here. Everything else comes out of the picks.</p>';
    html += (TRIP.schedule || []).map(function (d) {
      var slots = d.slots.slice().sort(function (a, b) {
        var am = toMin(a.time), bm = toMin(b.time);
        if (am === null && bm === null) return 0;
        if (am === null) return 1;
        if (bm === null) return -1;
        return am - bm;
      }).map(function (s) {
        return '<div class="slot ' + esc(s.kind) + '"><div class="st">' + esc(s.time) +
          '</div><div class="sd">' + esc(s.t) + "</div></div>";
      }).join("");
      return '<div class="day"><div class="dhead"><b>' + esc(d.day) + " " +
        esc(d.date.slice(8)) + " Aug</b><span>" + esc(d.label) + "</span></div>" + slots + "</div>";
    }).join("");
    el("homeSchedule").innerHTML = html;
  }

  /* ================= PICKS ================= */

  function renderPicks() {
    el("cats").innerHTML = (VENUES.categories || []).map(function (c, ci) {
      var cards = (c.items || []).map(function (it) { return venueCard(it); }).join("");
      var customs = store.state.customs
        .filter(function (x) { return x.cat === ci; })
        .map(customCard).join("");
      return "<section>" +
        '<div class="cathead"><h3>' + esc(c.title) + "</h3><span>" +
          (c.items || []).length + " options</span></div>" +
        (c.note ? '<p class="catnote">' + esc(c.note) + "</p>" : "") +
        '<div class="grid" id="g-' + ci + '">' + cards + customs +
          '<button type="button" class="addcard" id="add-' + ci + '" data-add="' + ci + '">+ Add your own</button>' +
        "</div></section>";
    }).join("");

    el("submittedLine").textContent = submittedLine();
  }

  function venueCard(it) {
    var on = sel.picks[it.id] ? " on" : "";
    return '<div class="card' + on + '" id="c-' + esc(it.id) + '" data-pick="' + esc(it.id) + '">' +
      '<img src="images/' + esc(it.id) + '.jpg" alt="" loading="lazy" ' +
        'onerror="BPnoPhoto(this,\'' + esc((it.name || "?").slice(0, 1).toUpperCase()) + '\')">' +
      '<div class="pad">' +
        "<h4>" + esc(it.name) + "</h4>" +
        '<div class="area">' + esc(it.area) + (it.illustrative ? " · photo illustrative" : "") + "</div>" +
        '<p class="desc">' + esc(it.desc) + "</p>" +
        '<p class="meta">' + esc(it.meta) + "</p>" +
        (it.key_fact ? '<p class="keyfact">' + esc(it.key_fact) + "</p>" : "") +
        '<div class="cardfoot">' +
          '<span class="pick" id="p-' + esc(it.id) + '">' + (on ? "✓ In" : "+ I'm in") + "</span>" +
          (it.lat ? '<button type="button" class="mini" data-goto="' + esc(it.id) + '">Get there</button>' : "") +
        "</div>" +
        '<div class="who" id="w-' + esc(it.id) + '"></div>' +
      "</div></div>";
  }

  function customCard(c) {
    var on = sel.picks[c.id] ? " on" : "";
    return '<div class="card' + on + '" id="c-' + esc(c.id) + '" data-pick="' + esc(c.id) + '">' +
      '<div class="ctile">' + esc((c.name || "?").slice(0, 1).toUpperCase()) + "</div>" +
      '<div class="pad"><h4>' + esc(c.name) + "</h4>" +
      '<div class="area">suggested by ' + esc(c.by) + "</div>" +
      (c.note ? '<p class="desc">' + esc(c.note) + "</p>" : "") +
      '<span class="pick" id="p-' + esc(c.id) + '">' + (on ? "✓ In" : "+ I'm in") + "</span>" +
      '<div class="who" id="w-' + esc(c.id) + '"></div></div></div>';
  }

  function onBoardClick(e) {
    // The ride links sit inside a card that toggles on click — don't also vote.
    if (e.target.closest("a, .mini")) return;
    var card = e.target.closest("[data-pick]");
    if (card) { toggle("picks", card.getAttribute("data-pick")); return; }
    var add = e.target.closest("[data-add]");
    if (add) openAdd(+add.getAttribute("data-add"));
  }

  function toggle(kind, id) {
    if (!me) return;
    if (sel[kind][id]) delete sel[kind][id]; else sel[kind][id] = true;
    var c = el("c-" + id), p = el("p-" + id);
    if (c) c.classList.toggle("on", !!sel[kind][id]);
    if (p) p.textContent = sel[kind][id] ? "✓ In" : "+ I'm in";
    updateBar();
  }

  /** Accommodation is a three-way call, not a tick: No / Can do / I like this. */
  function setStay(id, val) {
    if (!me || !id) return;
    if (sel.stay[id] === val) delete sel.stay[id]; else sel.stay[id] = val;
    var cur = sel.stay[id];
    var card = el("c-" + id);
    if (card) {
      card.classList.toggle("on", cur === "yes");
      card.classList.toggle("rated-ok", cur === "ok");
      card.classList.toggle("rated-no", cur === "no");
      Array.prototype.forEach.call(card.querySelectorAll("[data-rate]"), function (b) {
        b.classList.toggle("on", b.getAttribute("data-rate") === cur);
      });
    }
    updateBar();
  }

  function openAdd(ci) {
    var a = el("add-" + ci);
    a.removeAttribute("data-add");
    a.innerHTML = '<div style="width:100%">' +
      '<input id="ai-' + ci + '" maxlength="60" placeholder="What are you suggesting?">' +
      '<input id="an-' + ci + '" maxlength="90" placeholder="Where, price, why — optional">' +
      '<button type="button" class="btn" id="save-' + ci + '">Add it</button></div>';
    el("ai-" + ci).focus();
    el("save-" + ci).addEventListener("click", function (ev) {
      ev.stopPropagation();
      saveCustom(ci);
    });
  }

  async function saveCustom(ci) {
    var name = (el("ai-" + ci).value || "").trim();
    if (!name) { toast("Give it a name first"); return; }
    var note = (el("an-" + ci).value || "").trim();
    var item = {
      id: "c" + Date.now().toString(36),
      name: name.slice(0, 60),
      note: note.slice(0, 90),
      by: me,
      cat: ci,
      when: new Date().toISOString()
    };
    var r = await store.addCustom(item);
    sel.picks[item.id] = true;
    renderPicks();
    paintWho();
    updateBar();
    toast(r.synced
      ? "Added — it's on everyone's board now, and already ticked for you."
      : "Added on your phone and ticked. It'll go up for the others next time you're online.", 4500);
  }

  function votersFor(id, kind) {
    var group = store.state[kind || "picks"] || {};
    return CFG.names.filter(function (n) {
      return group[n] && (group[n].ids || []).indexOf(id) > -1;
    });
  }

  function chips(ids, kind) {
    var voted = CFG.names.filter(function (n) { return store.state[kind][n]; });
    ids.forEach(function (id) {
      var w = el("w-" + id);
      if (!w) return;
      var v = votersFor(id, kind);
      if (!v.length) return;
      var all = voted.length > 1 && v.length === voted.length;
      w.innerHTML = v.map(function (n) {
        return '<span class="' + (all ? "all" : (n === me ? "n" : "")) + '">' + esc(n) + "</span>";
      }).join("");
    });
  }

  /** Who said what about each place — always visible, no toggle over there. */
  function stayChips() {
    var word = { yes: "likes it", ok: "can do", no: "no" };
    (TRIP.stay.vote.options || []).forEach(function (o) {
      var w = el("w-" + o.id);
      if (!w) return;
      w.innerHTML = CFG.names.map(function (n) {
        var rec = store.state.stay[n];
        var v = rec && rec.r && rec.r[o.id];
        if (!v) return "";
        var cls = v === "yes" ? "n" : v === "no" ? "nay" : "";
        return '<span class="' + cls + '">' + esc(n) + " · " + word[v] + "</span>";
      }).join("");
    });
  }

  function paintWho() {
    document.querySelectorAll(".who").forEach(function (w) { w.innerHTML = ""; });
    stayChips();
    if (!showResults) return;
    chips(Object.keys(byId).concat(store.state.customs.map(function (c) { return c.id; })), "picks");
  }

  function submittedLine() {
    var voted = CFG.names.filter(function (n) { return store.state.picks[n]; });
    var missing = CFG.names.filter(function (n) { return !store.state.picks[n]; });
    return voted.length + " of " + CFG.names.length + " in" +
      (missing.length ? " — waiting on " + missing.join(", ") : " — everyone's voted") +
      (store.live ? " · live" : " · offline, saved on this phone");
  }

  function renderSummary() {
    var box = el("summary");
    if (!showResults) { box.innerHTML = ""; return; }
    var voted = CFG.names.filter(function (n) { return store.state.picks[n]; });
    var rows = [];
    Object.keys(byId).forEach(function (id) {
      var v = votersFor(id);
      if (v.length) rows.push({
        id: id, name: byId[id].item.name, what: gist(byId[id].item.desc),
        n: v.length, who: v
      });
    });
    store.state.customs.forEach(function (c) {
      var v = votersFor(c.id);
      if (v.length) rows.push({ id: c.id, name: c.name, what: c.note || "Suggested by " + c.by, n: v.length, who: v });
    });
    rows.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });

    if (!rows.length) { box.innerHTML = '<p class="sec-note">No votes in yet.</p>'; return; }

    box.innerHTML = '<div class="sec-title">The tally</div>' +
      '<p class="sec-note">★ = everyone who has voted so far picked it. Tap any row to jump to it below.</p>' +
      '<div class="rank">' + rows.map(function (r, i) {
        var bars = CFG.names.map(function (n) {
          return '<i class="' + (r.who.indexOf(n) > -1 ? "f" : "") + '"></i>';
        }).join("");
        var unan = voted.length > 1 && r.n === voted.length;
        return '<button type="button" class="r' + (unan ? " unan" : "") + '" data-jump="' + esc(r.id) + '">' +
          '<span class="n">' + (i + 1) + "</span>" +
          '<span class="nm"><b>' + esc(r.name) + "</b>" +
            (r.what ? '<i class="what">' + esc(r.what) + "</i>" : "") +
            "<small>" + esc(r.who.join(", ")) + "</small></span>" +
          '<span class="bars">' + bars + "</span></button>";
      }).join("") + "</div>";
  }

  /** First sentence of a description, trimmed to something scannable. */
  function gist(desc) {
    var s = String(desc || "").trim();
    if (!s) return "";
    var cut = s.search(/\.\s|—\s/);
    if (cut > 20) s = s.slice(0, cut + 1);
    s = s.replace(/[.\s]+$/, "");
    return s.length > 88 ? s.slice(0, 85).replace(/\s\S*$/, "") + "…" : s;
  }

  /* ================= STAY ================= */

  function renderStay() {
    var S = TRIP.stay;
    el("stayBlurb").textContent = S.vote.blurb;

    var vbox = el("stayVote");
    if (!S.vote.options.length) {
      vbox.innerHTML =
        '<div class="pending"><b>Options land here</b>' +
        "<p>Nothing to vote on yet.</p></div>";
    } else {
      var groups = S.vote.groups || [{ id: null, title: "Vote", note: "" }];
      vbox.innerHTML =
        (S.vote.note ? '<p class="sec-note" style="margin-top:14px">' + esc(S.vote.note) + "</p>" : "") +
        groups.map(function (g) {
          var opts = S.vote.options.filter(function (o) { return !g.id || o.group === g.id; });
          if (!opts.length) return "";
          return '<div class="sec-title">' + esc(g.title) + "</div>" +
            (g.note ? '<p class="sec-note">' + esc(g.note) + "</p>" : "") +
            '<div class="grid">' + opts.map(stayCard).join("") + "</div>";
        }).join("");
    }

    // Only once something has actually won — until then there is no "our place".
    var s = ourPlace();
    if (!s) {
      el("stayCurrent").innerHTML =
        '<p class="sec-note" style="margin-top:22px">Nothing is booked, and nothing else on the site ' +
        "assumes a winner — the airport routes and the from-our-place option on every venue stay " +
        "switched off until this is settled.</p>";
      return;
    }

    el("stayCurrent").innerHTML =
      '<div class="stay-hero">' +
        '<div class="sh"><span>Where we\'re staying</span><b>' + esc(s.name) + "</b></div>" +
        '<div class="body">' +
          '<div class="kv"><span class="k">Where</span><span>' + esc(s.full_address || s.area) + "</span></div>" +
          (s.sleeps ? '<div class="kv"><span class="k">Sleeps</span><span>' + s.sleeps + "</span></div>" : "") +
          (s.checkin ? '<div class="kv"><span class="k">In / out</span><span>' + esc(s.checkin) +
            " → " + esc(s.checkout || "") + "</span></div>" : "") +
          (s.perks ? '<ul class="perks">' + s.perks.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>" : "") +
          '<div class="links">' +
            '<button type="button" class="gotolink" data-goto="' + esc(s.id) + '">Get there</button>' +
            (s.link ? '<a href="' + esc(s.link) + '" target="_blank" rel="noopener">Listing</a>' : "") +
          "</div>" +
        "</div></div>";
  }

  function stayCard(o) {
    var cur = sel.stay[o.id];
    var on = cur === "yes" ? " on" : cur === "ok" ? " rated-ok" : cur === "no" ? " rated-no" : "";
    var reach = o.walk ? o.walk + " min walk to the bars" : (o.transit || "");
    var letter = esc((o.name || "?").slice(0, 1).toUpperCase());

    return '<div class="card' + on + '" id="c-' + esc(o.id) + '" data-stay="' + esc(o.id) + '">' +
      (o.image
        ? '<img src="' + esc(o.image) + '" alt="" loading="lazy" ' +
          "onerror=\"BPnoPhoto(this,'" + letter + "')\">"
        : '<div class="ctile">' + letter + "</div>") +
      '<div class="pad">' +
      (o.score ? '<div class="score"><b>' + esc(o.score.toFixed(1)) + "</b>" +
        (o.reviews ? "<span>" + o.reviews + " reviews</span>" : "") + "</div>" : "") +
      "<h4>" + esc(o.name) + "</h4>" +
      '<div class="area">' + esc(o.area || "") + "</div>" +
      '<div class="staytags">' +
        (reach ? '<span class="dist' + (o.walk ? "" : " far") + '">' + esc(reach) + "</span>" : "") +
        (o.est ? '<span class="price">' + esc(o.est) + "</span>" : "") +
      "</div>" +
      '<div class="pricenote' + (o.price_note ? " live" : "") + '">' +
        esc(o.price_note || "Estimate, not a quote — tap through for the real number") + "</div>" +
      (o.nearby ? '<p class="desc">' + esc(o.nearby) + "</p>" : "") +
      (o.desc ? '<p class="desc">' + esc(o.desc) + "</p>" : "") +
      (o.pros ? '<ul class="pc pros">' + o.pros.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (o.cons ? '<ul class="pc cons">' + o.cons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (o.why ? '<p class="keyfact">' + esc(o.why) + "</p>" : "") +
      (o.link ? '<a class="ride go pricebtn" href="' + esc(o.link) + '" target="_blank" rel="noopener">' +
        "Check live price</a>" : "") +
      '<div class="rate">' + (TRIP.stay.vote.scale || []).map(function (s) {
        return '<button type="button" class="rbtn r-' + s.id + (cur === s.id ? " on" : "") +
          '" data-opt="' + esc(o.id) + '" data-rate="' + esc(s.id) + '">' + esc(s.label) + "</button>";
      }).join("") + "</div>" +
      '<div class="cardfoot">' +
        (o.lat ? '<button type="button" class="mini" data-goto="' + esc(o.id) + '">Get there</button>' : "") +
      "</div>" +
      '<div class="who" id="w-' + esc(o.id) + '"></div></div></div>';
  }

  /* ================= INFO ================= */

  function renderInfo() {
    var A = TRIP.airport;
    var deflist = function (arr) {
      return '<div class="deflist">' + arr.map(function (x) {
        return '<div class="d"><b>' + esc(x.t) + "</b><span>" + esc(x.d) + "</span></div>";
      }).join("") + "</div>";
    };

    renderUpload();
    renderApps();
    var place = ourPlace();
    el("infoBody").innerHTML = '<div class="acc">' +
      (place
        ? panel("Airport → " + place.name, false,
            '<p style="margin:0 0 10px">' + esc(A.buffer_note) + "</p>" +
            renderRoutes(me ? arrival(person(me)) : null, place))
        : panel("Airport → town", false,
            "<p style=\"margin:0 0 10px\">Nowhere is booked yet, so the last leg is anyone's guess. " +
            "These are the two ways into the middle of the city; the rest fills in once the " +
            "accommodation vote lands.</p>" +
            '<p style="margin:0 0 10px">' + esc(A.buffer_note) + "</p>" +
            renderRoutes(me ? arrival(person(me)) : null, null))) +
      panel("Tickets, and where to buy them", false,
        ["airport", "single", "travelcard"].map(ticketBlock).join("")) +
      panel("Getting around", false, deflist(TRIP.getting_around)) +
      panel("Money", false, deflist(TRIP.money)) +
      panel("Hungarian, the useful fifteen", false,
        TRIP.phrases.map(function (p) {
          return '<div class="phrase"><div class="hu"><b>' + esc(p.hu) + "</b><small>" + esc(p.say) +
            "</small></div><div class=\"en\">" + esc(p.en) + "</div></div>";
        }).join("")) +
      panel("Don't get done", false,
        '<ul class="safety" style="margin:0;padding-left:18px">' +
        (VENUES.safety_notes || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") +
        "</ul>") +
      panel("Practical", false,
        deflist(TRIP.essentials) +
        '<p class="sec-note" style="margin-top:12px">' + esc(TRIP.trip.weather) + "</p>") +
    "</div>";

    el("infoFoot").innerHTML =
      "Everything here was checked in August 2026 — prices and hours drift, so spot-check anything you're paying for. " +
      "Venue photos: supplied, and Wikipedia / Wikimedia Commons (CC BY-SA / CC BY / CC0); several are illustrative stand-ins.";
  }

  function panel(title, open, inner) {
    return "<details" + (open ? " open" : "") + "><summary>" + esc(title) + "</summary>" +
      '<div class="inner">' + inner + "</div></details>";
  }

  /* ================= submit bar ================= */

  function activeKind() {
    if (view === "picks") return "picks";
    if (view === "stay" && TRIP && TRIP.stay.vote.options.length) return "stay";
    return null;
  }

  function updateBar() {
    var kind = activeKind();
    var bar = el("submitbar");
    if (!kind || !me) { bar.classList.remove("on"); return; }
    bar.classList.add("on");
    var n = Object.keys(sel[kind]).length;
    var total = kind === "stay" ? TRIP.stay.vote.options.length : 0;
    el("pickCount").textContent = kind === "stay" ? n + " / " + total : n;
    el("pickWord").textContent = kind === "stay" ? "rated" : "picked";
    el("sendBtn").textContent = store.state[kind][me] ? "Update" : "Submit";
    el("sendBtn").disabled = false;
  }

  function labelsFor(kind) {
    var ids = Object.keys(sel[kind]);
    if (kind === "stay") {
      var opts = TRIP.stay.vote.options;
      var scale = {};
      (TRIP.stay.vote.scale || []).forEach(function (s) { scale[s.id] = s.label; });
      return ids.map(function (id) {
        var o = opts.filter(function (x) { return x.id === id; })[0];
        return (o ? o.name : id) + " — " + (scale[sel.stay[id]] || sel.stay[id]);
      });
    }
    return ids.map(function (id) {
      if (byId[id]) return byId[id].item.name;
      var c = store.state.customs.filter(function (x) { return x.id === id; })[0];
      return c ? c.name + " *" : id;
    });
  }

  async function submit() {
    var kind = activeKind();
    if (!kind || !me) return;
    var ids = Object.keys(sel[kind]);
    if (!ids.length) { toast(kind === "stay" ? "Rate at least one place first" : "Nothing picked yet"); return; }

    var btn = el("sendBtn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    var labels = labelsFor(kind);

    var res = kind === "stay"
      ? await store.saveStay(me, sel.stay)
      : await store.saveVote(kind, me, ids);

    paintWho();
    renderSummary();
    renderClash();
    el("submittedLine").textContent = submittedLine();

    if (res.synced) {
      btn.textContent = "Sent ✓";
      toast(me + "'s " + (kind === "stay" ? "accommodation vote" : "picks") +
            " are in — everyone can see them now. Submitting again just replaces them.", 4000);
      setTimeout(function () { btn.disabled = false; updateBar(); }, 1800);
    } else {
      btn.disabled = false;
      updateBar();
      var text = "Budapest " + (kind === "stay" ? "accommodation" : "picks") + " — " + me + ": " + labels.join(", ");
      try {
        await navigator.clipboard.writeText(text);
        toast("Saved on your phone and copied to the clipboard — paste it in the group chat.", 5500);
      } catch (e) {
        toast("Saved on your phone. Screenshot the green cards and send them to the chat.", 5000);
      }
    }
  }

  boot();
})();
