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

  /** Ride-hailing and directions, pre-filled with the boat's coordinates. */
  function rideLinks(compact) {
    var s = TRIP.stay.current;
    if (!s.lat || !s.lng) return "";
    var addr = s.full_address || s.address;
    var uber = "https://m.uber.com/ul/?action=setPickup&pickup=my_location" +
      "&dropoff%5Blatitude%5D=" + s.lat +
      "&dropoff%5Blongitude%5D=" + s.lng +
      "&dropoff%5Bnickname%5D=" + encodeURIComponent(s.name) +
      "&dropoff%5Bformatted_address%5D=" + encodeURIComponent(addr);
    var maps = "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lng;
    return '<div class="rides">' +
      '<a class="ride go" href="' + uber + '" target="_blank" rel="noopener">Ride with Uber</a>' +
      '<a class="ride" href="' + maps + '" target="_blank" rel="noopener">Directions</a>' +
      '<button type="button" class="ride" data-copy="' + esc(addr) + '">Copy address</button>' +
      (compact ? "" : '<span class="ridenote">Uber drops you at the door. Bolt has no link like this — ' +
        "copy the address and paste it in.</span>") +
      "</div>";
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
      if (b) enter(b.getAttribute("data-name"));
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
    el("stayVote").addEventListener("click", function (e) {
      var c = e.target.closest("[data-stay]");
      if (c) toggle("stay", c.getAttribute("data-stay"));
    });

    document.addEventListener("click", function (e) {
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

    syncTopbar();
    window.addEventListener("resize", syncTopbar);
  }

  function openGate() {
    el("gate").hidden = false;
    el("topName").textContent = "—";
  }

  function enter(name) {
    me = name;
    store.setMe(name);
    el("gate").hidden = true;
    el("topName").textContent = name;
    el("topDays").textContent = "28–31 Aug";

    // Pre-tick whatever this person already has on record.
    sel = { picks: {}, stay: {} };
    ["picks", "stay"].forEach(function (kind) {
      var rec = store.state[kind][name];
      if (rec && rec.ids) rec.ids.forEach(function (id) { sel[kind][id] = true; });
    });

    renderAll();
    var v = (location.hash || "").replace("#/", "");
    go(CFG.names.indexOf(name) > -1 && v ? v : "home");
  }

  function go(v, fromHash) {
    if (["home", "picks", "stay", "info"].indexOf(v) === -1) v = "home";
    view = v;
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
    paintWho();
    renderSummary();
    renderClash();
    renderArrivals();
    renderStay();
    el("submittedLine").textContent = submittedLine();
    updateBar();
  }

  /* ================= HOME ================= */

  function renderHome() {
    renderCountdown();
    renderYou();
    renderClash();
    renderArrivals();
    renderStaySummary();
    renderSchedule();
  }

  var cdTimer = null;
  function renderCountdown() {
    var target = new Date(TRIP.trip.start + "T00:00:00" + TRIP.trip.tz_offset).getTime();
    function tick() {
      var diff = target - Date.now();
      var box = el("countdown");
      if (diff <= 0) {
        var end = new Date(TRIP.trip.end + "T23:59:59" + TRIP.trip.tz_offset).getTime();
        box.innerHTML = '<div class="kick">' + (Date.now() > end ? "That was" : "You are in") + '</div>' +
          '<div style="font-family:Georgia,serif;font-size:34px;margin-top:8px">Budapest</div>' +
          '<div class="line">' + esc(TRIP.trip.label) + "</div>";
        if (cdTimer) clearInterval(cdTimer);
        return;
      }
      var s = Math.floor(diff / 1000);
      var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
          m = Math.floor(s % 3600 / 60), ss = s % 60;

      var mine = me ? arrival(person(me)) : null;
      var line = mine
        ? "You land " + dayLong(mine.date) + " at " + mine.time + "."
        : "Flight not in yet — the countdown is the same for everyone.";

      box.innerHTML =
        '<div class="kick">Wheels up in</div>' +
        '<div class="units">' +
          '<div class="u"><b>' + d + "</b><span>days</span></div>" +
          '<div class="u"><b>' + h + "</b><span>hrs</span></div>" +
          '<div class="u"><b>' + m + "</b><span>min</span></div>" +
          '<div class="u"><b>' + ss + "</b><span>sec</span></div>" +
        "</div>" +
        '<div class="line">' + esc(line) + "</div>";
    }
    tick();
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = setInterval(tick, 1000);
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
              "<li>A door-to-door route to the boat, timed to <em>your</em> landing</li>" +
              "<li>Your slot on the arrivals board so everyone knows when you're in</li>" +
            "</ul>" +
          "</div>" +
        "</div>" +
        '<div class="sec-title">Getting to the boat</div>' +
        '<p class="sec-note">Generic version until your flight lands in here — timings start from whenever you touch down.</p>' +
        renderRoutes(null);
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
      '<div class="sec-title">Airport → the boat</div>' +
      '<p class="sec-note">You land at ' + esc(arr.time) + " on " + esc(dayLong(arr.date)) +
        ". " + esc(TRIP.airport.buffer_note) + "</p>" +
      renderRoutes(arr) +
      earlyNote(arr);
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

  /** Routes from BUD to the boat. With an arrival, every step gets a real clock time. */
  function renderRoutes(arr) {
    var A = TRIP.airport;
    var hour = arr ? arr.min / 60 : 12;
    var late = !!arr && (hour >= 22.5 || hour < 4);

    // Keep the authored order — public transport first, taxi as the fallback.
    // A late landing flips that: the metro has stopped, so the car leads.
    var routes = A.routes.slice();
    if (late) routes.sort(function (a, b) { return (b.id === "taxi") - (a.id === "taxi"); });

    var html = late ? '<div class="callout"><b>Landing late</b><p>' + esc(A.night_note) + "</p></div>" : "";

    html += routes.map(function (r, i) {
      var running = fits(r, hour);
      var t = arr ? arr.min + (A.buffer_arrive || 25) : null;

      var steps = r.steps.map(function (s) {
        var clock = (t !== null)
          ? '<div class="clock">' + fmtMin(t) + "<small>+" + s.min + "m</small></div>"
          : '<div class="clock" style="font-size:12px;color:var(--slate)">' + s.min + " min</div>";
        if (t !== null) t += s.min;
        return "<li>" + clock + "<div>" + esc(s.text) + "</div></li>";
      }).join("");

      var lands = (t !== null)
        ? '<li><div class="clock">' + fmtMin(t) + '<small>arrive</small></div><div><b>At Meder u. 9.</b> ' +
          esc(dur(t - arr.min)) + " door to door from touchdown.</div></li>"
        : "";

      return '<div class="route' + (i === 0 ? "" : " alt") + '">' +
        '<div class="rhead"><b>' + esc(r.label) + '</b><span class="badge">' + esc(r.badge) + "</span></div>" +
        '<ul class="steps">' + steps + lands + "</ul>" +
        (r.ride ? rideLinks(false) : "") +
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

  /** Landing well before 15:00 check-in is worth calling out. */
  function earlyNote(arr) {
    if (!arr) return "";
    var A = TRIP.airport;
    var atBoat = arr.min + (A.buffer_arrive || 25) +
      A.routes[0].steps.reduce(function (n, s) { return n + s.min; }, 0);
    var checkin = 15 * 60;
    if (arr.date !== TRIP.trip.start || atBoat > checkin - 45) return "";
    return '<div class="callout"><b>You get there before check-in</b><p>' +
      "On that route you're at the dock around " + fmtMin(atBoat) +
      " and check-in isn't until 15:00. Message the host about dropping bags early — " +
      "and Margaret Island is the closest thing to kill a few hours, ten minutes down the road.</p></div>";
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
    var s = TRIP.stay.current;
    el("homeStay").innerHTML =
      '<div class="sec-title">The boat</div>' +
      '<div class="board">' +
        '<div class="row"><div class="av">⚓</div><div class="nm"><b>' + esc(s.name) +
          "</b><small>" + esc(s.address) + " · " + esc(s.metro) + "</small></div></div>" +
        '<div class="row"><div class="av">↓</div><div class="nm"><b>Check in</b><small>' + esc(s.checkin) + "</small></div></div>" +
        '<div class="row"><div class="av">↑</div><div class="nm"><b>Check out</b><small>' + esc(s.checkout) + "</small></div></div>" +
      "</div>" +
      rideLinks(true) +
      '<div class="links"><a href="#/stay">Details &amp; vote</a>' +
      '<a href="' + esc(s.link) + '" target="_blank" rel="noopener">Listing</a></div>';
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
        '<span class="pick" id="p-' + esc(it.id) + '">' + (on ? "✓ In" : "+ I'm in") + "</span>" +
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

  function paintWho() {
    document.querySelectorAll(".who").forEach(function (w) { w.innerHTML = ""; });
    // Accommodation chips are always on — there's no results toggle over there.
    chips(TRIP.stay.vote.options.map(function (o) { return o.id; }), "stay");
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
      if (v.length) rows.push({ id: id, name: byId[id].item.name, area: byId[id].item.area, n: v.length, who: v });
    });
    store.state.customs.forEach(function (c) {
      var v = votersFor(c.id);
      if (v.length) rows.push({ id: c.id, name: c.name, area: "suggested by " + c.by, n: v.length, who: v });
    });
    rows.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });

    if (!rows.length) { box.innerHTML = '<p class="sec-note">No votes in yet.</p>'; return; }

    box.innerHTML = '<div class="sec-title">The tally</div>' +
      '<p class="sec-note">★ = everyone who has voted so far picked it.</p>' +
      '<div class="rank">' + rows.map(function (r, i) {
        var bars = CFG.names.map(function (n) {
          return '<i class="' + (r.who.indexOf(n) > -1 ? "f" : "") + '"></i>';
        }).join("");
        var unan = voted.length > 1 && r.n === voted.length;
        return '<div class="r' + (unan ? " unan" : "") + '">' +
          '<span class="n">' + (i + 1) + "</span>" +
          '<span class="nm"><b>' + esc(r.name) + "</b><small>" + esc(r.who.join(", ")) + "</small></span>" +
          '<span class="bars">' + bars + "</span></div>";
      }).join("") + "</div>";
  }

  /* ================= STAY ================= */

  function renderStay() {
    var S = TRIP.stay;
    el("stayBlurb").textContent = S.vote.open && !S.vote.options.length
      ? S.vote.blurb
      : "Pick every option you'd be happy with, not just your favourite.";

    var vbox = el("stayVote");
    if (!S.vote.options.length) {
      vbox.innerHTML =
        '<div class="pending"><b>Options land here</b>' +
        "<p>Nothing to vote on yet. As soon as the shortlist is in, this turns into a board just like the picks page.</p></div>";
    } else {
      vbox.innerHTML = '<div class="sec-title">Vote</div>' +
        '<div class="grid">' + S.vote.options.map(stayCard).join("") + "</div>";
    }

    var s = S.current;
    el("stayCurrent").innerHTML =
      '<div class="stay-hero">' +
        '<div class="sh"><span>' + esc(S.vote.options.length ? "Currently booked" : "The plan right now") + "</span><b>" +
          esc(s.name) + "</b></div>" +
        '<div class="body">' +
          '<div class="kv"><span class="k">What</span><span>' + esc(s.kind) + ", sleeps " + s.sleeps + "</span></div>" +
          '<div class="kv"><span class="k">Where</span><span>' + esc(s.address) + "</span></div>" +
          '<div class="kv"><span class="k">Metro</span><span>' + esc(s.metro) + "</span></div>" +
          '<div class="kv"><span class="k">In / out</span><span>' + esc(s.checkin) + " → " + esc(s.checkout) + "</span></div>" +
          "<ul class=\"perks\">" + s.perks.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>" +
          rideLinks(false) +
          '<div class="links">' +
            '<a href="' + esc(s.link) + '" target="_blank" rel="noopener">Listing</a>' +
            '<a href="' + esc(s.map) + '" target="_blank" rel="noopener">Maps</a>' +
          "</div>" +
        "</div></div>";
  }

  function stayCard(o) {
    var on = sel.stay[o.id] ? " on" : "";
    return '<div class="card' + on + '" id="c-' + esc(o.id) + '" data-stay="' + esc(o.id) + '">' +
      (o.image ? '<img src="' + esc(o.image) + '" alt="" loading="lazy">'
               : '<div class="ctile">' + esc((o.name || "?").slice(0, 1).toUpperCase()) + "</div>") +
      '<div class="pad"><h4>' + esc(o.name) + "</h4>" +
      '<div class="area">' + esc(o.area || "") + "</div>" +
      (o.desc ? '<p class="desc">' + esc(o.desc) + "</p>" : "") +
      (o.meta ? '<p class="meta">' + esc(o.meta) + "</p>" : "") +
      '<span class="pick" id="p-' + esc(o.id) + '">' + (on ? "✓ In" : "+ I'm in") + "</span>" +
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

    el("infoBody").innerHTML = '<div class="acc">' +
      panel("Airport → the boat", true,
        "<p style=\"margin:0 0 10px\">" + esc(A.buffer_note) + "</p>" + renderRoutes(me ? arrival(person(me)) : null)) +
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
    el("pickCount").textContent = n;
    el("pickWord").textContent = kind === "stay" ? (n === 1 ? "option" : "options") : "picked";
    el("sendBtn").textContent = store.state[kind][me] ? "Update" : "Submit";
    el("sendBtn").disabled = false;
  }

  function labelsFor(kind) {
    var ids = Object.keys(sel[kind]);
    if (kind === "stay") {
      var opts = TRIP.stay.vote.options;
      return ids.map(function (id) {
        var o = opts.filter(function (x) { return x.id === id; })[0];
        return o ? o.name : id;
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
    if (!ids.length) { toast("Nothing picked yet"); return; }

    var btn = el("sendBtn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    var labels = labelsFor(kind);

    var res = await store.saveVote(kind, me, ids);

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
