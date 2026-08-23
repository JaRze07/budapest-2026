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
  var sel = { picks: {}, vetoes: {} };
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

  /** Who is in for this, and who has ruled it out. Empty for the stay options,
      which are voted on somewhere else entirely. */
  function whoWants(id) {
    var ins = votersFor(id), nos = vetoedBy(id);
    if (!ins.length && !nos.length) return "";
    var chip = function (n, cls) {
      return '<span class="' + cls + (n === me ? " me" : "") + '">' + esc(n) + "</span>";
    };
    return '<div class="sheetvotes">' +
      (ins.length
        ? '<div class="svrow"><b>In</b><span class="svchips">' +
            ins.map(function (n) { return chip(n, "yes"); }).join("") + "</span></div>"
        : '<div class="svrow"><b>In</b><span class="svnone">nobody yet</span></div>') +
      (nos.length
        ? '<div class="svrow"><b>Hard no</b><span class="svchips">' +
            nos.map(function (n) { return chip(n, "no"); }).join("") + "</span></div>"
        : "") +
    "</div>";
  }

  /** Two ways to reach anything: from where we sleep, and from wherever you are. */
  function openSheet(id) {
    var src = byId[id] ? byId[id].item
            : store.state.customs.filter(function (c) { return c.id === id; })[0]
            || TRIP.stay.vote.options.filter(function (o) { return o.id === id; })[0];
    if (!src || !src.lat) return;

    var to = pt(src);
    var place = ourPlace();
    var fb = src.fromBase || {};
    var html = '<div class="kick">Getting there</div>' +
      "<h3>" + esc(src.name) + "</h3>" +
      '<div class="sheetarea">' + esc(src.area || "") +
        (fb.walk ? " · " + fb.walk.min + " min walk" : "") + "</div>" +
      (src.desc ? '<p class="sheetdesc">' + esc(src.desc) + "</p>" : "") +
      (src.hours ? '<p class="sheethours">' + esc(src.hours) + "</p>" : "") +
      (src.meta ? '<p class="sheetmeta">' + esc(src.meta) + "</p>" : "") +
      (src.key_fact ? '<p class="keyfact">' + esc(src.key_fact) + "</p>" : "") +
      whoWants(id);

    if (place && place.id !== src.id) {
      html += fromBlock("From our place", place.name, to, pt(place)) + howToGetThere(src);
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
    sheetFor = null;
    el("sheet").hidden = true;
    document.body.style.overflow = "";
  }


  /* Walking and transit from the flat, worked out once against a real foot
     router and BKK's own timetable, so no key or live call is needed here. */
  function howToGetThere(src) {
    var f = src.fromBase;
    if (!f || (!f.walk && !f.transit)) return "";

    // Transit only earns its place if it saves a real amount of time.
    var worthIt = f.walk && f.transit && (f.walk.min - f.transit.min) >= 6;
    var walkFirst = !f.transit || !worthIt;

    var km = f.walk ? (f.walk.m >= 1000
      ? (f.walk.m / 1000).toFixed(1) + " km"
      : f.walk.m + " m") : "";

    var walkRow = f.walk
      ? '<div class="hrow' + (walkFirst ? " best" : "") + '">' +
          '<div class="hmain">' +
            '<span class="hmode">Walk</span>' +
            '<span class="hdesc">' + km + (walkFirst ? " — quicker than waiting for anything" : "") + "</span>" +
          "</div>" +
          '<span class="htime">' + f.walk.min + " min</span>" +
        "</div>"
      : "";

    var transitRow = f.transit
      ? '<div class="hrow' + (walkFirst ? "" : " best") + '">' +
          '<div class="hmain">' +
            '<span class="hmode">' + esc(f.transit.summary) + "</span>" +
            '<span class="hdesc">' +
              (f.transit.changes ? f.transit.changes + " change" + (f.transit.changes > 1 ? "s" : "") : "no changes") +
            "</span>" +
            '<ol class="hlegs">' + (f.transit.legs || []).map(function (l) {
              return '<li class="' + esc(l.mode) + '">' + esc(l.text) + "</li>";
            }).join("") + "</ol>" +
          "</div>" +
          '<span class="htime">' + f.transit.min + " min</span>" +
        "</div>"
      : "";

    return '<div class="howto">' +
      '<div class="hhead">From the flat</div>' +
      (walkFirst ? walkRow + transitRow : transitRow + walkRow) +
    "</div>";
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

  /* ================= shared files ================= */

  /* A plain dropbox. Jacek drops anything in — flight screenshots, photos —
     and it lands in the database as a data URL, so there's no file hosting
     and everyone sees it immediately. Two of them can be tagged as Nhi's
     before and after. */
  function renderUpload() {
    var box = el("infoUpload");
    if (!box) return;
    var mine = me === CFG.uploader;
    // The id is the database key, not a field on the record — carry it across
    // or every button loses its target the moment the data comes back synced.
    var files = Object.keys(store.state.files || {})
      .filter(function (k) { return store.state.files[k]; })
      .map(function (k) { return Object.assign({}, store.state.files[k], { id: k }); })
      .sort(function (a, b) { return String(b.when).localeCompare(String(a.when)); });

    var slots = (TRIP.transformation && TRIP.transformation.slots) || [];
    var assigned = store.state.assign || {};

    var html = '<div class="sec-title">Shared files</div>' +
      '<p class="sec-note">' + (mine
        ? "Drop anything in — flight screenshots, photos. Everyone can see what lands here."
        : "Anything Jacek has shared. Screenshots, photos, whatever's useful.") + "</p>";

    if (mine) {
      html += '<label class="dropzone" id="dropzone">' +
        '<input type="file" accept="image/*" multiple hidden id="fileInput">' +
        '<span class="dzicon">+</span>' +
        "<b>Drop images here</b>" +
        "<span>or tap to choose — several at once is fine</span>" +
      "</label>";
    }

    if (!files.length) {
      html += '<p class="sec-note" style="margin-top:14px">Nothing shared yet.</p>';
    } else {
      html += '<div class="filegrid">' + files.map(function (f) {
        var tags = slots.filter(function (s) { return assigned[s.key] === f.id; })
          .map(function (s) { return '<span class="ftag">' + esc(s.label.split(" —")[0]) + "</span>"; }).join("");
        return '<figure class="fileitem">' +
          '<img src="' + esc(f.data) + '" alt="' + esc(f.name || "") + '" data-lightbox="' + esc(f.id) + '">' +
          (tags ? '<div class="ftags">' + tags + "</div>" : "") +
          '<figcaption>' + esc(f.name || "image") + '<small>' + esc(f.by || "") + "</small></figcaption>" +
          (mine
            ? '<div class="fileacts">' +
                slots.map(function (s) {
                  var on = assigned[s.key] === f.id;
                  return '<button type="button" class="mini' + (on ? " onmini" : "") +
                    '" data-assign="' + esc(s.key) + '" data-file="' + esc(f.id) + '">' +
                    esc(s.label.split(" —")[0]) + "</button>";
                }).join("") +
                '<button type="button" class="mini del" data-del="' + esc(f.id) + '">Delete</button>' +
              "</div>"
            : "") +
        "</figure>";
      }).join("") + "</div>";
    }

    box.innerHTML = html;
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

  async function acceptFiles(list) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) {
      return f && /^image\//.test(f.type);
    });
    if (!files.length) { toast("Images only, for now."); return; }

    var done = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      toast("Processing " + (i + 1) + " of " + files.length + "…", 15000);
      var url;
      try {
        url = await shrink(f, 1100, 0.82);
        var q = 0.82;
        // The row has a hard cap — step quality down rather than fail.
        while (url.length > 650000 && q > 0.4) { q -= 0.12; url = await shrink(f, 1100, q); }
        if (url.length > 650000) url = await shrink(f, 700, 0.6);
      } catch (e) { continue; }

      var res = await store.saveFile({
        id: "f" + Date.now().toString(36) + i,
        data: url,
        name: String(f.name || "image").slice(0, 80),
        by: me,
        when: new Date().toISOString()
      });
      if (res.synced) done++;
      renderUpload();
    }
    renderTransformation();
    toast(done ? done + " uploaded — everyone can see " + (done === 1 ? "it" : "them") + " now."
               : "Upload failed. Check you're online.", 4000);
  }

  async function assignFile(slot, fileId) {
    var cur = store.state.assign[slot];
    await store.assignSlot(slot, cur === fileId ? "" : fileId);
    renderUpload();
    renderTransformation();
  }

  async function removeFile(id) {
    await store.deleteFile(id);
    renderUpload();
    renderTransformation();
    toast("Deleted.", 2000);
  }

  function lightbox(id) {
    var f = store.state.files[id];
    if (!f) return;
    el("sheetBody").innerHTML =
      '<div class="kick">Shared file</div>' +
      "<h3>" + esc(f.name || "image") + "</h3>" +
      '<div class="sheetarea">Shared by ' + esc(f.by || "") + "</div>" +
      '<img class="lightimg" src="' + esc(f.data) + '" alt="">';
    el("sheet").hidden = false;
    document.body.style.overflow = "hidden";
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
    return {
      date: out.date, time: last.arr, from: last.from_city, min: toMin(last.arr),
      tz: last.arr_tz || TRIP.trip.tz_offset
    };
  }

  /* The exact instant they touch down. Built with an explicit offset, so the
     countdown is right whichever timezone the phone is in — the difference
     between two absolute instants doesn't care where you're standing. */
  function arrivalInstant(a) {
    if (!a) return null;
    var t = new Date(a.date + "T" + a.time + ":00" + a.tz).getTime();
    return isNaN(t) ? null : t;
  }

  /** Their landing time as the phone would show it, if that differs from Budapest. */
  function localEcho(instant, budapestTime) {
    try {
      var local = new Date(instant).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      return local === budapestTime ? "" : local;
    } catch (e) { return ""; }
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
        fetch("data/venues.json?v=mt6afqqs").then(function (r) { return r.json(); }),
        fetch("data/trip.json?v=mt6afqqs").then(function (r) { return r.json(); })
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
      sel = { picks: {}, vetoes: {} };
      openGate();
    });

    el("tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-view]");
      if (b) go(b.getAttribute("data-view"));
    });

    el("toggleResults").addEventListener("click", function () {
      showResults = !showResults;
      this.textContent = showResults ? "Hide the tally" : "Show the tally";
      renderSummary();
    });


    // Delegated once — the containers persist, only their innerHTML changes.
    // Both boards, not just the categories — proposals live in their own
    // section, and without this nobody but the proposer could tick one.
    el("cats").addEventListener("click", onBoardClick);
    el("proposed").addEventListener("click", onBoardClick);
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

    // File picker, plus drag-and-drop anywhere on the dropzone.
    document.addEventListener("change", function (e) {
      if (e.target.id === "fileInput" && e.target.files && e.target.files.length) {
        acceptFiles(e.target.files);
        e.target.value = "";
      }
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        var d = e.target.closest && e.target.closest("#dropzone");
        if (!d) return;
        e.preventDefault();
        d.classList.add("over");
      });
    });
    document.addEventListener("dragleave", function (e) {
      var d = e.target.closest && e.target.closest("#dropzone");
      if (d) d.classList.remove("over");
    });
    document.addEventListener("drop", function (e) {
      var d = e.target.closest && e.target.closest("#dropzone");
      if (!d) return;
      e.preventDefault();
      d.classList.remove("over");
      if (e.dataTransfer && e.dataTransfer.files) acceptFiles(e.dataTransfer.files);
    });

    document.addEventListener("click", function (e) {
      var lb = e.target.closest("[data-lightbox]");
      if (lb) { lightbox(lb.getAttribute("data-lightbox")); return; }

      var asg = e.target.closest("[data-assign]");
      if (asg) { assignFile(asg.getAttribute("data-assign"), asg.getAttribute("data-file")); return; }

      var del = e.target.closest("[data-del]");
      if (del) { removeFile(del.getAttribute("data-del")); return; }

      if (e.target.id === "addTile") { toggleProposeForm(true); return; }
      if (e.target.id === "pCancel") { toggleProposeForm(false); return; }
      if (e.target.id === "pSave") { saveCustom(); return; }

      if (e.target.id === "addExpense") { editing = "new"; el("moneyAdd")._draft = null; el("moneyAdd")._mode = null; el("moneyAdd")._payer = null; renderAddForm(); return; }
      if (e.target.id === "exCancel") { editing = null; el("moneyAdd")._mode = null; el("moneyAdd")._payer = null; el("moneyAdd")._draft = null; renderMoney(); return; }
      if (e.target.id === "exSave") { saveExpenseForm(); return; }
      if (e.target.id === "exDelete") { deleteExpenseForm(); return; }

      var ed = e.target.closest("[data-editex]");
      if (ed) {
        editing = ed.getAttribute("data-editex");
        var box = el("moneyAdd"); box._mode = null; box._payer = null; box._draft = null;
        renderAddForm();
        return;
      }
      var pay = e.target.closest("[data-payer]");
      if (pay) {
        captureDraft();
        el("moneyAdd")._payer = pay.getAttribute("data-payer");
        renderAddForm();
        return;
      }
      var md = e.target.closest("[data-mode]");
      if (md) {
        captureDraft();
        el("moneyAdd")._mode = md.getAttribute("data-mode");
        renderAddForm();
        return;
      }

      var hy = e.target.closest("[data-hype]");
      if (hy) { setHype(+hy.getAttribute("data-hype")); return; }

      var pl = e.target.closest("[data-plan]");
      if (pl) { openSlotPicker(pl.getAttribute("data-plan")); return; }

      if (e.target && e.target.id === "altFilter") return;

      var al = e.target.closest("[data-alt]");
      if (al) {
        setAlt(al.getAttribute("data-for"), al.getAttribute("data-alt"),
               al.getAttribute("data-slotfor"));
        return;
      }

      var sl = e.target.closest("[data-slot]");
      if (sl) { setSlot(sl.getAttribute("data-for"), sl.getAttribute("data-slot")); return; }

      var jump = e.target.closest("[data-jump]");
      if (jump) { scrollToCard(jump.getAttribute("data-jump")); return; }

      var mv = e.target.closest("[data-move]");
      if (mv) {
        moveActivity(mv.getAttribute("data-for"), mv.getAttribute("data-move"),
                     mv.getAttribute("data-in"));
        return;
      }

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

    document.addEventListener("input", function (e) {
      if (e.target.closest && e.target.closest(".expform")) updatePreview();
    });
    document.addEventListener("change", function (e) {
      var f = e.target.id === "receiptFile" && e.target.files && e.target.files[0];
      if (f) { readReceipt(f); e.target.value = ""; }
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
    sel = { picks: {}, vetoes: {} };
    var pk = store.state.picks[name];
    if (pk && pk.ids) pk.ids.forEach(function (id) { sel.picks[id] = true; });
    var vt = store.state.vetoes[name];
    if (vt && vt.ids) vt.ids.forEach(function (id) { sel.vetoes[id] = true; });

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
    renderMoney();
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
    renderMoney();
    renderArrivals();
    renderHypeOthers();
    renderTransformation();
    renderUpload();
    renderProposed();
    renderSchedule();          // someone else may have slotted something
    // After the boards are rebuilt — they would otherwise wipe the chips.
    paintWho();
    renderSummary();
    el("submittedLine").textContent = submittedLine();
    updateBar();
  }

  /* ================= HOME ================= */

  function renderHome() {
    renderCountdown();
    renderTransformation();
    renderArrivals();
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

    // Counts down to this person's own landing, not a shared trip start.
    var mine = me ? arrival(person(me)) : null;
    var landing = arrivalInstant(mine);
    var target = landing || new Date(TRIP.trip.start + "T00:00:00" + TRIP.trip.tz_offset).getTime();
    var end = new Date(TRIP.trip.end + "T23:59:59" + TRIP.trip.tz_offset).getTime();
    el("cdKick").textContent = landing ? "You land in" : "Wheels up in";

    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) {
        el("cdKick").textContent = Date.now() > end ? "That was" : "You're in";
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

      if (!landing) {
        el("cdLine").textContent = "Flight not in yet — this counts down to the start of the trip.";
        return;
      }
      var echo = localEcho(landing, mine.time);
      el("cdLine").textContent =
        "You land " + dayLong(mine.date) + " at " + mine.time + " Budapest time" +
        (echo ? " — " + echo + " where you are." : ".");
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

    // A file tagged in the dropbox wins; otherwise the one that ships with the site.
    var pics = (T.slots || []).map(function (s) {
      var fid = (store.state.assign || {})[s.key];
      var f = fid && store.state.files[fid];
      var src = f ? f.data : (s.src || null);
      return src
        ? '<img src="' + esc(src) + '" alt="' + esc(s.label) + '">'
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
    var box = el("infoYou");
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
    /* three long route cards — folded away, since you read them once */
    return '<details class="foldout"><summary>' +
        '<span class="foldtitle">Airport → the flat</span>' +
        '<span class="foldhint">' + (arr
          ? "you land " + esc(arr.time) + " · three ways in"
          : "three ways in") + "</span>" +
      "</summary><div class=\"foldbody\">" +
      (arr
        ? '<p class="sec-note">You land at ' + esc(arr.time) + " on " + esc(dayLong(arr.date)) +
          ". " + esc(TRIP.airport.buffer_note) + "</p>"
        : '<p class="sec-note">Timings fill in with real clock times once your flight is in here.</p>') +
      renderRoutes(arr, place) +
      earlyNote(arr, place) +
      "</div></details>";
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
      el("infoStay").innerHTML =
        '<div class="sec-title">Where we sleep</div>' +
        '<div class="pending"><b>Not decided</b>' +
        "<p>Five options are up. " + voted.length + " of " + CFG.names.length +
        " have voted" + (voted.length ? " — " + esc(voted.join(", ")) : "") + ".</p>" +
        '<a class="btn gobtn" href="#/stay">See the options</a></div>';
      return;
    }

    el("infoStay").innerHTML =
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

  var WORD_TIME = {
    morning: 8 * 60, day: 10 * 60, noon: 12 * 60, afternoon: 14 * 60,
    /* evening is a catch-all block, so it sits after the last arrival of the day */
    dinner: 19 * 60, evening: 20 * 60, night: 22 * 60, late: 23 * 60
  };
  function slotMin(time) {
    var m = toMin(time);
    if (m !== null) return m;
    var w = WORD_TIME[String(time || "").trim().toLowerCase()];
    /* half a minute later, so a real clock time always wins the tie */
    return (w === undefined ? 24 * 60 : w) + 0.5;
  }

  function plannedItem(id, slotId) {
    var v = byId[id] ? byId[id].item : customById(id);
    var w = v && v.fromBase && v.fromBase.walk;
    var t = v && v.fromBase && v.fromBase.transit;
    /* transit only earns its place when it saves a real walk */
    var how = w ? (t && (w.min - t.min) >= 6
      ? t.min + " min · " + t.summary
      : w.min + " min walk") : "";
    var line = (v && (metaLine(v) || v.note)) || "";
    var open = v && v.lat;                  /* customs have no pin to open */
    /* the arrows have to be siblings of the row button, not inside it */
    return '<div class="prow">' +
      (open ? '<button type="button" class="ptag pitem" data-goto="' + esc(id) + '">'
            : '<span class="ptag pitem plain">') +
        "<b>" + esc(nameOf(id)) +
          (catOf(id) ? ' <i class="cat">(' + esc(catOf(id)) + ")</i>" : "") + "</b>" +
        (line ? "<small>" + esc(line) + "</small>" : "") +
        (how ? '<span class="phow">' + esc(how) + "</span>" : "") +
      (open ? "</button>" : "</span>") +
      (canPlan()
        ? '<span class="pmove">' +
            '<button type="button" data-move="up" data-for="' + esc(id) + '" data-in="' + esc(slotId) +
              '" title="Move up">▲</button>' +
            '<button type="button" data-move="down" data-for="' + esc(id) + '" data-in="' + esc(slotId) +
              '" title="Move down">▼</button>' +
          "</span>"
        : "") +
    "</div>";
  }

  /* Two hours at the airport plus 55 on the 100E — the same figures the
     "leaves for the airport" rows use. */
  var AIRPORT_LEAD = 175;

  /** The people in town when a band starts. Landing counts, leaving does not. */
  function whoIn(slot) {
    var day = (TRIP.schedule || []).filter(function (d) {
      return d.day + " " + parseInt(d.date.slice(8), 10) === slot.day;
    })[0];
    var at = toMin(slot.from);
    if (!day || at === null) return [];
    return (TRIP.people || []).filter(function (p) {
      var arr = arrival(p), dep = departure(p);
      if (!arr) return false;
      if (arr.date > day.date) return false;                       // not here yet
      if (arr.date === day.date && arr.min > at) return false;     // lands later today
      if (dep) {
        if (dep.date < day.date) return false;                     // already gone
        if (dep.date === day.date && dep.min - AIRPORT_LEAD <= at) return false;
      }
      return true;
    });
  }

  function whoInTag(slot) {
    var who = whoIn(slot);
    if (!who.length || who.length === (TRIP.people || []).length) {
      return who.length ? '<span class="swho all">all four</span>' : "";
    }
    return '<span class="swho">' + esc(who.map(function (p) { return p.initial; }).join(", ")) +
      '</span>';
  }

  function renderSchedule() {
    var html = '<div class="sec-title">The shape of it</div>' +
      '<p class="sec-note">The fixed points, with whatever has been slotted in sitting where it falls in the day.</p>';
    html += (TRIP.schedule || []).map(function (d) {
      var dayName = d.day + " " + parseInt(d.date.slice(8), 10);

      /* Fixed points and slotted activities are one timeline, not two lists. */
      var rows = d.slots.map(function (s) {
        return { at: slotMin(s.time), html: '<div class="slot ' + esc(s.kind) + '"><div class="st">' +
          esc(s.time) + '</div><div class="sd">' + esc(s.t) + "</div></div>" };
      });

      (TRIP.slots || []).filter(function (s) { return s.day === dayName; }).forEach(function (s) {
        var got = plannedIn(s.id);
        /* An empty band still shows, so the shape of the day is visible before
           anything is chosen — and so the meal slots are not invisible. */
        if (!got.length) {
          rows.push({
            at: (toMin(s.from) === null ? 24 * 60 : toMin(s.from)) + 0.75,
            html: '<div class="slot band"><div class="st">' + esc(s.when) + whoInTag(s) + "</div>" +
              '<div class="sd bandempty">Open' +
                (s.note ? "<small>" + esc(s.note) + "</small>" : "") + "</div></div>"
          });
          return;
        }
        rows.push({
          /* a hair behind anything fixed at the same time, so 10:00 checkout still leads */
          at: (toMin(s.from) === null ? 24 * 60 : toMin(s.from)) + 0.75,
          html: '<div class="slot planned"><div class="st">' + esc(s.when) + whoInTag(s) + "</div>" +
            '<div class="sd">' + groupsIn(s.id).map(function (g) {
              return g.length === 1
                ? plannedItem(g[0], s.id)
                : '<div class="pgroup">' + g.map(function (x) { return plannedItem(x, s.id); })
                    .join('<div class="por">or</div>') + "</div>";
            }).join("") + "</div></div>"
        });
      });

      rows.sort(function (a, b) { return a.at - b.at; });

      return '<div class="day"><div class="dhead"><b>' + esc(d.day) + " " +
        esc(d.date.slice(8)) + " Aug</b><span>" + esc(d.label) + "</span></div>" +
        rows.map(function (r) { return r.html; }).join("") + "</div>";
    }).join("");
    el("homeSchedule").innerHTML = html;
  }


  /* ================= WEATHER =================
     WMO codes, grouped into the only distinctions that change what you pack. */

  var SKY = {
    clear:  { d: "M12 4V2M12 22v-2M4 12H2m20 0h-2M6 6L4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18", c: 8, label: "Clear" },
    part:   { label: "Some cloud" },
    cloud:  { label: "Cloudy" },
    fog:    { label: "Fog" },
    drizzle:{ label: "Drizzle" },
    rain:   { label: "Rain" },
    storm:  { label: "Storms" }
  };

  function skyOf(c) {
    if (c === 0) return "clear";
    if (c <= 2) return "part";
    if (c === 3) return "cloud";
    if (c === 45 || c === 48) return "fog";
    if (c >= 51 && c <= 57) return "drizzle";
    if (c >= 95) return "storm";
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
    return "cloud";
  }

  /* Small inline icons — no image requests, and they read at 34 px. */
  function skyIcon(kind) {
    var sun = '<circle cx="12" cy="9" r="4.2" fill="var(--brass)"/>';
    var rays = '<g stroke="var(--brass)" stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M12 1.6v1.8M12 14.6v1.8M4.6 9H2.8m18.4 0h-1.8M6.7 3.7 5.4 2.4m11.9 1.3 1.3-1.3M6.7 14.3l-1.3 1.3m11.9-1.3 1.3 1.3"/></g>';
    var cloud = '<path d="M7.5 19h9.2a3.4 3.4 0 0 0 .3-6.8 5 5 0 0 0-9.6-1A3.4 3.4 0 0 0 7.5 19z" ' +
      'fill="#fff" stroke="var(--slate)" stroke-width="1.4" stroke-linejoin="round"/>';
    var drops = '<g stroke="var(--laser)" stroke-width="1.8" stroke-linecap="round">' +
      '<path d="M9 21v1.6M12.5 21v2.2M16 21v1.6"/></g>';
    var bolt = '<path d="M12.6 20.4 10 24l4.6-1.2L12.9 26" fill="none" stroke="var(--brass)" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    var body = {
      clear:   rays + sun,
      part:    rays + sun + cloud,
      cloud:   cloud,
      fog:     cloud + '<g stroke="var(--slate)" stroke-width="1.4" stroke-linecap="round" opacity=".7">' +
                 '<path d="M6 21h12M8 23.4h8"/></g>',
      drizzle: cloud + '<g stroke="var(--laser)" stroke-width="1.6" stroke-linecap="round" opacity=".85">' +
                 '<path d="M10 21v1.2M13.5 21v1.6M17 21v1.2"/></g>',
      rain:    cloud + drops,
      storm:   cloud + bolt
    }[kind] || cloud;
    return '<svg class="wico" viewBox="0 0 24 27" aria-hidden="true">' + body + "</svg>";
  }

  /** What the four days together mean for the bag. */
  function packingFor(days) {
    var tips = [];
    var hot = days.filter(function (d) { return d.max >= 30; });
    var wet = days.filter(function (d) { return d.pop >= 40 || d.sky === "storm"; });
    var cool = days.filter(function (d) { return d.min <= 15; });
    var breezy = days.filter(function (d) { return d.wind >= 30; });
    var names = function (list) {
      var n = list.map(function (d) { return d.name; });
      return n.length === 1 ? n[0] : n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
    };

    if (hot.length) {
      var peak = hot.slice().sort(function (x, y) { return y.max - x.max; })[0];
      tips.push("Sun cream and a refillable bottle — " + peak.name + " hits " + peak.max + "°" +
        (hot.length > 1 ? ", and " + (hot.length - 1) + " other day" + (hot.length > 2 ? "s are" : " is") +
          " over 30°." : "."));
    }
    if (wet.length) {
      tips.push("A small umbrella for " + names(wet) +
        (wet.some(function (d) { return d.sky === "storm"; }) ? " — thunderstorms, not drizzle." : "."));
    }
    if (cool.length) tips.push("Something with sleeves for the evenings; " + names(cool) + " drops to " +
      Math.min.apply(null, cool.map(function (d) { return d.min; })) + "° overnight.");
    if (breezy.length) tips.push("Windy on " + names(breezy) + " — not a night for a hat.");
    tips.push("Swimwear worn underneath on bath days, and shoes you can walk 10 km in.");
    return tips;
  }

  async function renderWeather() {
    var box = el("infoWeather");
    if (!box) return;
    var stay = TRIP.stay && TRIP.stay.vote && TRIP.stay.vote.options
      ? TRIP.stay.vote.options.filter(function (o) { return o.id === TRIP.stay.chosen; })[0] : null;
    var lat = (stay && stay.lat) || 47.4979, lng = (stay && stay.lng) || 19.0402;
    var first = (TRIP.schedule || [])[0], last = (TRIP.schedule || [])[(TRIP.schedule || []).length - 1];
    if (!first || !last) return;

    var key = "bp_wx_" + first.date + "_" + last.date;
    var data = null;
    try {
      var cached = JSON.parse(localStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.at < 3 * 3600 * 1000) data = cached.d;
    } catch (e) {}

    if (!data) {
      try {
        var r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng +
          "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max," +
          "precipitation_sum,wind_speed_10m_max&timezone=Europe%2FBudapest" +
          "&start_date=" + first.date + "&end_date=" + last.date);
        if (!r.ok) return;
        var j = await r.json();
        if (!j.daily || !j.daily.time || !j.daily.time.length) return;
        data = j.daily;
        try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), d: data })); } catch (e) {}
      } catch (e) { return; }
    }

    var days = data.time.map(function (t, i) {
      var d = (TRIP.schedule || []).filter(function (x) { return x.date === t; })[0];
      return {
        date: t,
        name: d ? d.day : new Date(t).toDateString().slice(0, 3),
        num: parseInt(t.slice(8), 10),
        sky: skyOf(data.weather_code[i]),
        max: Math.round(data.temperature_2m_max[i]),
        min: Math.round(data.temperature_2m_min[i]),
        pop: data.precipitation_probability_max[i],
        mm: data.precipitation_sum[i],
        wind: Math.round(data.wind_speed_10m_max[i])
      };
    });
    if (!days.length) return;

    box.innerHTML =
      '<div class="wx">' +
        '<div class="wxhead"><span>The forecast</span><small>updated from Open-Meteo</small></div>' +
        '<div class="wxdays">' + days.map(function (d) {
          return '<div class="wxday' + (d.pop >= 40 || d.sky === "storm" ? " wet" : "") + '">' +
            '<b>' + esc(d.name.slice(0, 3)) + " " + d.num + "</b>" +
            skyIcon(d.sky) +
            '<span class="wxt"><em>' + d.max + "°</em> " + d.min + "°</span>" +
            '<span class="wxr">' + (d.pop == null ? "—" : d.pop + "%") +
              (d.mm >= 1 ? " · " + d.mm.toFixed(0) + "mm" : "") + "</span>" +
            '<span class="wxs">' + esc(SKY[d.sky].label) + "</span>" +
          "</div>";
        }).join("") + "</div>" +
        '<ul class="wxpack">' + packingFor(days).map(function (t) {
          return "<li>" + esc(t) + "</li>";
        }).join("") + "</ul>" +
      "</div>";
  }

  /* ================= PICKS ================= */

  function renderPicks() {
    // Proposals live in their own section up top, not buried in a category.
    el("cats").innerHTML = (VENUES.categories || []).map(function (c, ci) {
      var cards = (c.items || []).map(function (it) { return venueCard(it); }).join("");
      return "<section>" +
        '<div class="cathead"><h3>' + esc(c.title) + "</h3><span>" +
          (c.items || []).length + " options</span></div>" +
        (c.note ? '<p class="catnote">' + esc(c.note) + "</p>" : "") +
        '<div class="grid" id="g-' + ci + '">' + cards + "</div></section>";
    }).join("");

    renderProposed();
    el("submittedLine").textContent = submittedLine();
  }

  /** Everything any of us added ourselves, with whoever put it forward. */
  function renderProposed() {
    var box = el("proposed");
    if (!box) return;
    var list = store.state.customs.slice()
      .sort(function (a, b) { return String(a.when).localeCompare(String(b.when)); });

    // Built exactly like a category section — same sticky header, same grid.
    // The only difference is that its last tile adds rather than votes.
    box.innerHTML = "<section>" +
      '<div class="cathead"><h3>Proposed activities</h3><span>' +
        (list.length ? list.length + " added by us" : "add your own") + "</span></div>" +
      '<p class="catnote">Anything we put forward ourselves rather than off the lists below. ' +
      "Whoever proposes something counts as in on it.</p>" +
      '<div class="grid">' + list.map(customCard).join("") + addTile() + "</div>" +
    "</section>";
  }

  /* The one place anything can be added. It used to sit at the end of every
     category, which put six identical tiles on the page. */
  var proposeOpen = false;

  function addTile() {
    if (!proposeOpen) {
      return '<button type="button" class="addcard" id="addTile">+ Propose something</button>';
    }
    return '<div class="addcard open">' +
      '<input id="pName" maxlength="60" placeholder="What are you suggesting?">' +
      '<input id="pNote" maxlength="90" placeholder="Where, price, why — optional">' +
      '<div class="pfrow">' +
        '<button type="button" class="btn dim" id="pCancel">Cancel</button>' +
        '<button type="button" class="btn" id="pSave">Add it</button>' +
      "</div></div>";
  }

  function toggleProposeForm(open) {
    proposeOpen = open;
    renderProposed();
    paintWho();
    if (open && el("pName")) el("pName").focus();
  }

  function distLine(it) {
    var f = it.fromBase || {}, w = f.walk, t = f.transit;
    if (!w) return "";
    var km = w.m >= 1000 ? (w.m / 1000).toFixed(1) + " km" : w.m + " m";
    var s = km + " from the flat · " + w.min + " min walk";
    if (t && (w.min - t.min) >= 6) s += " · or " + t.min + " min by " + t.summary;
    return s;
  }

  /** Opening hours plus whatever else the card says, as one line. */
  function metaLine(v) {
    if (!v) return "";
    return [v.hours, v.meta].filter(Boolean).join(" · ");
  }

  function vetoBtn(id) {
    var no = !!sel.vetoes[id];
    return '<button type="button" class="veto' + (no ? " on" : "") + '" data-veto="' + esc(id) + '">' +
      (no ? "✕ Ruled out" : "Hard no") + "</button>";
  }

  function venueCard(it) {
    var on = (sel.picks[it.id] ? " on" : "") + (sel.vetoes[it.id] ? " vetoed" : "");
    return '<div class="card' + on + '" id="c-' + esc(it.id) + '" data-pick="' + esc(it.id) + '">' +
      (it.isNew ? '<span class="newbadge">New</span>' : "") +
      '<img src="images/' + esc(it.id) + '.jpg" alt="" loading="lazy" ' +
        'onerror="BPnoPhoto(this,\'' + esc((it.name || "?").slice(0, 1).toUpperCase()) + '\')">' +
      '<div class="pad">' +
        "<h4>" + esc(it.name) + "</h4>" +
        '<div class="area">' + esc(it.area) + (it.illustrative ? " · photo illustrative" : "") + "</div>" +
        (it.fromBase ? '<div class="fromflat">' + esc(distLine(it)) + "</div>" : "") +
        (it.hours ? '<div class="hours">' + esc(it.hours) + "</div>" : "") +
        '<p class="desc">' + esc(it.desc) + "</p>" +
        '<p class="meta">' + esc(it.meta) + "</p>" +
        (it.key_fact ? '<p class="keyfact">' + esc(it.key_fact) + "</p>" : "") +
        '<div class="cardfoot">' +
          '<span class="pick" id="p-' + esc(it.id) + '">' + (on ? "✓ In" : "+ I'm in") + "</span>" +
          vetoBtn(it.id) +
          (it.lat ? '<button type="button" class="mini" data-goto="' + esc(it.id) + '">Get there</button>' : "") +
        "</div>" +
        '<div class="who" id="w-' + esc(it.id) + '"></div>' +
      "</div></div>";
  }

  function customCard(c) {
    var on = sel.picks[c.id] ? " on" : "";
    return '<div class="card' + on + '" id="c-' + esc(c.id) + '" data-pick="' + esc(c.id) + '">' +
      '<div class="ctile">' + esc((c.name || "?").slice(0, 1).toUpperCase()) + "</div>" +
      '<div class="pad">' +
      '<div class="proposer">Proposed by <b>' + esc(c.by) + "</b></div>" +
      "<h4>" + esc(c.name) + "</h4>" +
      (c.note ? '<p class="desc">' + esc(c.note) + "</p>" : "") +
      '<div class="cardfoot">' +
        '<span class="pick" id="p-' + esc(c.id) + '">' + (on ? "✓ In" : "+ I'm in") + "</span>" +
      "</div>" +
      '<div class="who" id="w-' + esc(c.id) + '"></div></div></div>';
  }

  function onBoardClick(e) {
    // The ride links sit inside a card that toggles on click — don't also vote.
    if (e.target.closest("a, .mini")) return;
    var v = e.target.closest("[data-veto]");
    if (v) { toggleVeto(v.getAttribute("data-veto")); return; }
    var card = e.target.closest("[data-pick]");
    if (card) { toggle("picks", card.getAttribute("data-pick")); return; }
  }

  /* In and hard-no are opposites — saying one clears the other. */
  function toggleVeto(id) {
    if (!me) return;
    var now = !sel.vetoes[id];
    if (now) { sel.vetoes[id] = true; delete sel.picks[id]; }
    else delete sel.vetoes[id];
    paintCard(id);
    updateBar();
    queueSave("picks");
  }

  function paintCard(id) {
    var c = el("c-" + id), p = el("p-" + id);
    if (c) {
      c.classList.toggle("on", !!sel.picks[id]);
      c.classList.toggle("vetoed", !!sel.vetoes[id]);
      var b = c.querySelector("[data-veto]");
      if (b) {
        b.classList.toggle("on", !!sel.vetoes[id]);
        b.textContent = sel.vetoes[id] ? "✕ Ruled out" : "Hard no";
      }
    }
    if (p) p.textContent = sel.picks[id] ? "✓ In" : "+ I'm in";
  }

  function toggle(kind, id) {
    if (!me) return;
    if (sel[kind][id]) delete sel[kind][id]; else sel[kind][id] = true;
    if (kind === "picks" && sel.picks[id]) delete sel.vetoes[id];
    var c = el("c-" + id), p = el("p-" + id);
    if (c) c.classList.toggle("on", !!sel[kind][id]);
    if (p) p.textContent = sel[kind][id] ? "✓ In" : "+ I'm in";
    updateBar();
    queueSave(kind);
  }

  /* Every tap writes. Debounced, because tapping through a category fires a
     dozen changes a second and each one would otherwise be its own request —
     and out-of-order replies could land an older selection last. */
  var saveTimer = null, savingKind = null, saveInFlight = false, dirty = false;

  function queueSave(kind) {
    savingKind = kind;
    dirty = true;
    setSaveState("pending");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 700);
  }

  async function flushSave() {
    if (!me || !savingKind) return;
    if (saveInFlight) return;          // the running loop will pick the change up
    saveInFlight = true;

    // Loop rather than return: a tap during the request sets `dirty` again,
    // and the last state on screen has to be the last state written.
    while (dirty) {
      dirty = false;
      setSaveState("saving");
      var res = await store.saveVote("picks", me, Object.keys(sel.picks));
      if (res.synced) res = await store.saveVote("vetoes", me, Object.keys(sel.vetoes));
      if (!res.synced) {
        saveInFlight = false;
        setSaveState("failed");
        return;
      }
    }
    saveInFlight = false;
    setSaveState("saved");

    paintWho();
    renderSummary();
    el("submittedLine").textContent = submittedLine();
  }

  function setSaveState(s) {
    var e = el("saveState");
    if (!e) return;
    e.className = "savestate " + s;
    e.textContent = s === "pending" ? "…"
      : s === "saving" ? "Saving…"
      : s === "failed" ? "Not saved — offline?"
      : "Saved";
    if (s === "saved") {
      clearTimeout(e._h);
      e._h = setTimeout(function () {
        if (e.textContent === "Saved") { e.className = "savestate"; e.textContent = "Saved as you go"; }
      }, 2200);
    }
  }

  async function saveCustom() {
    var name = (el("pName").value || "").trim();
    if (!name) { toast("Give it a name first"); return; }
    var item = {
      id: "c" + Date.now().toString(36),
      name: name.slice(0, 60),
      note: (el("pNote").value || "").trim().slice(0, 90),
      by: me,
      cat: 0,
      when: new Date().toISOString()
    };

    var r = await store.addCustom(item);
    sel.picks[item.id] = true;

    /* Proposing it counts as being in on it. Merge into what has already been
       submitted rather than the in-progress selection, so this cannot publish
       edits they have not committed yet. */
    var stored = (store.state.picks[me] && store.state.picks[me].ids) || [];
    if (stored.indexOf(item.id) === -1) {
      await store.saveVote("picks", me, stored.concat([item.id]));
    }

    proposeOpen = false;
    renderProposed();
    paintWho();
    renderSummary();
    updateBar();
    toast(r.synced
      ? "Added — it is on everyone’s board, and you are counted in on it."
      : "Added on your phone. It will go up for the others next time you are online.", 4500);
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
      var all = kind === "picks" && voted.length > 1 && v.length === voted.length;
      w.innerHTML += v.map(function (n) {
        return '<span class="' + (kind === "vetoes" ? "no" : (all ? "all" : (n === me ? "n" : ""))) + '">' +
          (kind === "vetoes" ? "✕ " : "") + esc(n) + "</span>";
      }).join("");
    });
  }

  /** Anyone at all saying no is enough to take it off the table — but only for
      the listed venues. Whatever we put forward ourselves is not up for veto. */
  function vetoedBy(id) { return byId[id] ? votersFor(id, "vetoes") : []; }

  function paintWho() {
    document.querySelectorAll(".who").forEach(function (w) { w.innerHTML = ""; });
    var all = Object.keys(byId).concat(store.state.customs.map(function (c) { return c.id; }));
    chips(all, "picks");
    chips(all, "vetoes");
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
    var voted = CFG.names.filter(function (n) {
      return store.state.picks[n] || store.state.vetoes[n];
    });

    /* Everything anyone has an opinion on, for or against. A hard no no longer
       removes a row — it just paints one of the bars red, so it can still be
       planned around whoever objected. */
    var rows = [];
    function addRow(id, name, what) {
      var ins = votersFor(id), nos = vetoedBy(id);
      if (!ins.length && !nos.length) return;
      rows.push({ id: id, name: name, what: what, n: ins.length, who: ins, no: nos });
    }
    Object.keys(byId).forEach(function (id) {
      addRow(id, byId[id].item.name, gist(byId[id].item.desc));
    });
    store.state.customs.forEach(function (c) {
      addRow(c.id, c.name, c.note || "Suggested by " + c.by);
    });

    /* Most wanted first; a clean run beats the same score with a no against it. */
    rows.sort(function (x, y) {
      return y.n - x.n || x.no.length - y.no.length || x.name.localeCompare(y.name);
    });

    if (!rows.length) { box.innerHTML = '<p class="sec-note">No votes in yet.</p>'; return; }

    // Built like the other sections so it doesn't read as an orphan block.
    box.innerHTML = "<section>" +
      '<div class="cathead"><h3>The tally</h3><span>' + rows.length + " with votes</span></div>" +
      '<p class="catnote">Green is in, red is a hard no. ★ = everyone who has voted wants it. Tap a row to jump to it.</p>' +
      '<div class="rank">' + rows.map(function (r, i) {
        var bars = CFG.names.map(function (n) {
          var cls = r.who.indexOf(n) > -1 ? "f" : (r.no.indexOf(n) > -1 ? "x" : "");
          return '<i class="' + cls + '" title="' + esc(n) + '"></i>';
        }).join("");
        var unan = voted.length > 1 && r.n === voted.length && !r.no.length;
        var mine = slotsOf(r.id).map(slotById).filter(Boolean);
        return '<div class="rwrap">' +
          '<button type="button" class="r' + (unan ? " unan" : "") + (r.no.length ? " contested" : "") +
            '" data-jump="' + esc(r.id) + '">' +
            '<span class="n">' + (i + 1) + "</span>" +
            '<span class="nm"><b>' + esc(r.name) + "</b>" +
              (catOf(r.id) ? '<i class="cat">(' + esc(catOf(r.id)) + ")</i>" : "") +
              (r.what ? '<i class="what">' + esc(r.what) + "</i>" : "") +
              (byId[r.id] && byId[r.id].item.hours
                ? '<i class="rhours">' + esc(byId[r.id].item.hours) + "</i>" : "") +
              mine.map(function (s) {
                return '<i class="slotted">' + esc(s.day) + " · " + esc(s.when) +
                  esc(altSuffix(r.id, s.id)) + "</i>";
              }).join("") +
              "<small>" + esc(r.who.join(", ")) + "</small>" +
              (r.no.length ? '<small class="nos">✕ ' + esc(r.no.join(", ")) + "</small>" : "") +
              "</span>" +
            '<span class="bars">' + bars + "</span>" +
          "</button>" +
          (canPlan()
            ? '<button type="button" class="slotadd' + (mine.length ? " on" : "") +
              '" data-plan="' + esc(r.id) + '" title="Put this in a slot">' +
              (mine.length ? (mine.length > 1 ? String(mine.length) : "✎") : "+") + "</button>"
            : "") +
        "</div>";
      }).join("") + "</div></section>";
  }


  /* ---- slotting activities into the days ---- */

  /** " · or Blue Bird, Vibe Rooms" for a row that is one of several alternatives. */
  function altSuffix(id, slotId) {
    var others = groupOf(anchorOf(id), slotId).filter(function (x) { return x !== id; });
    return others.length ? " · or " + others.map(nameOf).join(", ") : "";
  }

  function slotById(id) {
    return (TRIP.slots || []).filter(function (s) { return s.id === id; })[0] || null;
  }
  function customById(id) {
    return store.state.customs.filter(function (c) { return c.id === id; })[0] || null;
  }

  /** "Bars", "Late & private", or "Proposed" for anything we put up ourselves. */
  function catOf(id) {
    if (!byId[id]) return store.state.customs.some(function (c) { return c.id === id; }) ? "Proposed" : "";
    var c = (VENUES.categories || [])[byId[id].cat];
    return c ? (c.short || c.title) : "";
  }

  function nameOf(id) {
    if (byId[id]) return byId[id].item.name;
    var c = store.state.customs.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : id;
  }
  /* ---- alternatives ----
     alt[x] = y means "x is an alternative to y". y is always a real anchor:
     nothing points at something that itself points elsewhere. */

  function anchorOf(id) {
    var alt = store.state.alt || {};
    var seen = {}, cur = id;
    while (alt[cur] && !seen[cur]) { seen[cur] = 1; cur = alt[cur]; }
    return cur;
  }

  /** Everything grouped with this one, anchor first, in plan order. */
  function groupOf(anchor, withinSlot) {
    return plannedIn(withinSlot).filter(function (x) { return anchorOf(x) === anchor; })
      .sort(function (x, y) { return (x === anchor ? -1 : 0) - (y === anchor ? -1 : 0); });
  }

  /** The bands' contents as groups: [[a], [b, c, d]] rather than a flat list. */
  function groupsIn(slotId) {
    var out = [], seen = {};
    plannedIn(slotId).forEach(function (id) {
      var k = anchorOf(id);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(groupOf(k, slotId));
    });
    /* a group takes the position of its anchor, so an "or" block moves as one */
    return out.sort(function (x, y) { return byOrd(x[0], y[0]); });
  }

  /** Everything slotted into one band, in the order the tally ranks them. */
  function plannedIn(slotId) {
    var p = store.state.plan || {};
    return Object.keys(p).filter(function (id) { return p[id] && p[id][slotId]; }).sort(byOrd);
  }

  /** Every band this activity sits in, in day order. */
  function slotsOf(id) {
    var set = (store.state.plan || {})[id] || {};
    return (TRIP.slots || []).filter(function (s) { return set[s.id]; }).map(function (s) { return s.id; });
  }

  /** Slotted-in order. Anything from before this existed sorts last, alphabetically. */
  function ordOf(id) {
    var o = (store.state.ord || {})[id];
    return typeof o === "number" ? o : Infinity;
  }
  function byOrd(x, y) {
    return ordOf(x) - ordOf(y) || nameOf(x).localeCompare(nameOf(y));
  }

  /* Only the planner gets to move things about — everyone else just sees where
     they landed. There is no auth behind this, so it is a tidiness measure
     rather than a lock. */
  function canPlan() { return me === (CFG.planner || CFG.uploader); }

  var sheetFor = null;

  function openSlotPicker(activityId) {
    sheetFor = activityId;
    var cur = {};
    slotsOf(activityId).forEach(function (s) { cur[s] = true; });
    var inAny = Object.keys(cur).length;
    var days = [];
    (TRIP.slots || []).forEach(function (s) {
      var d = days.filter(function (x) { return x.day === s.day; })[0];
      if (!d) { d = { day: s.day, slots: [] }; days.push(d); }
      d.slots.push(s);
    });

    el("sheetBody").innerHTML =
      '<div class="kick">When are we doing this</div>' +
      "<h3>" + esc(nameOf(activityId)) + "</h3>" +
      '<div class="slotpick">' + days.map(function (d) {
        return '<div class="slotday"><div class="slotdayname">' + esc(d.day) + "</div>" +
          d.slots.map(function (s) {
            var here = plannedIn(s.id).filter(function (x) { return x !== activityId; });
            return '<button type="button" class="slotbtn' + (cur[s.id] ? " on" : "") +
              '" data-slot="' + esc(s.id) + '" data-for="' + esc(activityId) + '">' +
              '<span class="slotwhen">' + esc(s.when) + "</span>" +
              (s.note ? '<span class="slotnote">' + esc(s.note) + "</span>" : "") +
              (cur[s.id] ? '<span class="slotoff">tap to take it out of this one</span>' : "") +
              (here.length ? '<span class="slothas">already here: ' +
                esc(here.map(nameOf).join(", ")) + "</span>" : "") +
            "</button>";
          }).join("") + "</div>";
      }).join("") +
      "</div>" + altPicker(activityId, cur) +
      '<p class="slothint">Tap any band to add it. Tap a lit one to take it out. ' +
        'It can sit in as many as you like.</p>' +
      (inAny ? '<button type="button" class="btn dim clearslot" data-slot="" data-for="' +
        esc(activityId) + '">Take it off the plan entirely</button>' : "");
    el("sheet").hidden = false;
    document.body.style.overflow = "hidden";
    var f = el("altFilter");
    if (f) f.addEventListener("input", function () {
      var q = f.value.trim().toLowerCase();
      Array.prototype.forEach.call(el("altList").children, function (b) {
        b.hidden = q && b.getAttribute("data-name").indexOf(q) < 0;
      });
    });
  }

  /* Anything already planned can be the thing this is an alternative to.
     Pick one and you land in its slot, in its group. */
  /** Every member of the group, whether or not it is currently planned. */
  function groupMembers(id) {
    var anchor = anchorOf(id);
    return [anchor].concat(Object.keys(store.state.alt || {}).filter(function (x) {
      return x !== anchor && anchorOf(x) === anchor;
    }));
  }

  /** Everything grouped with this one, wherever it is planned. */
  function myGroup(activityId) {
    var anchor = anchorOf(activityId);
    var all = [anchor].concat(Object.keys(store.state.alt || {}).filter(function (x) {
      return anchorOf(x) === anchor && x !== anchor;
    }));
    return all.filter(function (x) { return slotsOf(x).length; });
  }

  function altPicker(activityId, cur) {
    var mine = anchorOf(activityId);
    var group = myGroup(activityId);
    var planned = slotsOf(activityId).length;

    /* other groups this one could join */
    var options = [];
    (TRIP.slots || []).forEach(function (s) {
      groupsIn(s.id).forEach(function (g) {
        if (g[0] === activityId) return;                   // not an alternative to itself
        if (g[0] === mine) return;                         // already in this group
        options.push({ slot: s, anchor: g[0], with: g.slice(1) });
      });
    });

    /* anything anyone has picked that is not already in this group */
    var candidates = [];
    if (planned) {
      var votedFor = {};
      CFG.names.forEach(function (n) {
        var rec = (store.state.picks || {})[n];
        (rec && rec.ids ? rec.ids : []).forEach(function (id) { votedFor[id] = true; });
      });
      candidates = Object.keys(votedFor)
        .filter(function (id) { return group.indexOf(id) < 0 && id !== activityId; })
        .filter(function (id) { return byId[id] || customById(id); })
        .sort(function (x, y) { return nameOf(x).localeCompare(nameOf(y)); });
    }

    if (!options.length && !planned) return "";

    var html = '<div class="altpick">';

    if (group.length > 1) {
      html += '<div class="altkick">One of these</div>' +
        '<p class="altnote">You are doing one of them, not all. Drop any with the ✕.</p>' +
        '<div class="altgroup">' + group.map(function (id) {
          return '<span class="altchip' + (id === mine ? " anchor" : "") + '">' + esc(nameOf(id)) +
            (id === mine ? "" : '<button type="button" data-alt="" data-for="' + esc(id) +
              '" title="Take it out of the group">✕</button>') + "</span>";
        }).join("") + "</div>";
    }

    if (candidates.length) {
      html += '<div class="altkick">Add another alternative</div>' +
        '<p class="altnote">As many as you like. They join ' + esc(nameOf(mine)) +
          ' in ' + esc(slotsOf(mine).map(function (s) { return (slotById(s) || {}).when; }).join(" and ")) +
          '.</p>' +
        '<input id="altFilter" class="altfilter" placeholder="Type to narrow the list">' +
        '<div class="altlist" id="altList">' + candidates.map(function (id) {
          return '<button type="button" class="altrow" data-alt="' + esc(mine) +
            '" data-slotfor="' + esc(slotsOf(mine)[0] || "") + '" data-for="' + esc(id) +
            '" data-name="' + esc(nameOf(id).toLowerCase()) + '">' + esc(nameOf(id)) + "</button>";
        }).join("") + "</div>";
    }

    if (options.length) {
      html += '<div class="altkick">Or join something else</div>' +
        options.map(function (o) {
          return '<button type="button" class="altbtn" data-alt="' + esc(o.anchor) +
            '" data-slotfor="' + esc(o.slot.id) + '" data-for="' + esc(activityId) + '">' +
            "<b>or " + esc(nameOf(o.anchor)) + "</b>" +
            '<span class="altwhen">' + esc(o.slot.day) + " · " + esc(o.slot.when) +
              (o.with.length ? " · already or " + esc(o.with.map(nameOf).join(", ")) : "") + "</span>" +
          "</button>";
        }).join("");
    }

    if (activityId !== mine) {
      html += '<button type="button" class="btn dim altbtn standalone" data-alt="" data-for="' +
        esc(activityId) + '">Stand on its own instead</button>';
    }
    return html + "</div>";
  }

  /** Make one activity an alternative to another, moving it into that slot. */
  async function setAlt(activityId, anchorId, slotId) {
    if (anchorId) {
      var anchor = anchorOf(anchorId);
      await store.saveAlt(activityId, anchor);
      /* match the anchor exactly: every band it is in, and none it is not */
      var want = slotsOf(anchor);
      if (!want.length && slotId) want = [slotId];
      var had = slotsOf(activityId);
      for (var i2 = 0; i2 < had.length; i2++) {
        if (want.indexOf(had[i2]) < 0) await store.savePlan(activityId, had[i2], false);
      }
      for (var j2 = 0; j2 < want.length; j2++) {
        await store.savePlan(activityId, want[j2], true);
        if (ordOf(activityId) === Infinity) await store.saveOrd(activityId, nextOrd(want[j2]));
      }
    } else {
      await store.saveAlt(activityId, "");
    }
    renderSummary();
    renderSchedule();
    /* stay on whichever activity's sheet is open, so several can be added */
    if (sheetFor) openSlotPicker(sheetFor);
    else closeSheet();
    toast(anchorId
      ? nameOf(activityId) + " or " + nameOf(anchorOf(anchorId)) + " — one of them"
      : nameOf(activityId) + " stands on its own", 2600);
  }

  /** One past whatever is already in the band. */
  function nextOrd(slotId) {
    var here = plannedIn(slotId).map(ordOf).filter(function (n) { return isFinite(n); });
    return (here.length ? Math.max.apply(null, here) : 0) + 1;
  }

  /* Moving swaps positions with the neighbour in the same scope: inside its own
     "or" group if it is grouped, otherwise among the blocks of the band. */
  async function moveActivity(id, dir, slotId) {
    if (!canPlan() || !slotId) return;
    var anchor = anchorOf(id);
    var grouped = groupOf(anchor, slotId);
    /* The anchor represents its whole block, so moving it moves the block among
       the other blocks. Moving one of its alternatives reorders inside the block. */
    var inGroup = grouped.length > 1 && id !== anchor;
    var list = inGroup ? grouped.slice() : groupsIn(slotId).map(function (g) { return g[0]; });
    var me2 = list.indexOf(id) > -1 ? id : anchor;
    var i = list.indexOf(me2);
    var j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;

    /* give both ends real numbers before swapping, or Infinity swaps with Infinity */
    var a1 = ordOf(list[i]), b1 = ordOf(list[j]);
    if (!isFinite(a1) || !isFinite(b1)) {
      for (var k = 0; k < list.length; k++) await store.saveOrd(list[k], k + 1);
      a1 = ordOf(list[i]); b1 = ordOf(list[j]);
    }
    await store.saveOrd(list[i], b1);
    await store.saveOrd(list[j], a1);
    renderSchedule();
    renderSummary();
  }

  async function setSlot(activityId, slotId) {
    /* no slot id means the clear-all button */
    if (!slotId) return clearFromPlan(activityId);
    var team = groupMembers(activityId);
    if ((store.state.plan || {})[activityId] && store.state.plan[activityId][slotId]) {
      for (var r = 0; r < team.length; r++) await store.savePlan(team[r], slotId, false);
      if (!slotsOf(activityId).length) await detachAlt(activityId);
      openSlotPicker(activityId);
      renderSummary();
      renderSchedule();
      toast(nameOf(activityId) + " out of " + (slotById(slotId) || {}).when, 2600);
      return;
    }
    /* Adding a band used to drop the activity out of its group. That was right
       when a thing could only be in one band; now it just means the group gains
       a band, so leave the grouping alone — "Stand on its own" is the way out. */
    /* the group moves together, so it never appears split across bands */
    for (var q = 0; q < team.length; q++) {
      await store.savePlan(team[q], slotId, true);
      if (ordOf(team[q]) === Infinity) await store.saveOrd(team[q], nextOrd(slotId));
    }
    openSlotPicker(activityId);                 /* stays open, so you can add another */
    renderSummary();
    renderSchedule();
    toast(nameOf(activityId) + " → " + (slotById(slotId) || {}).day + ", " +
      (slotById(slotId) || {}).when, 2600);
  }

  /** Off the plan altogether, from every band. */
  async function clearFromPlan(activityId) {
    await store.clearPlan(activityId);
    await detachAlt(activityId);
    closeSheet();
    renderSummary();
    renderSchedule();
    toast(nameOf(activityId) + " taken off the plan", 3000);
  }

  /* Leaving the plan must not strand alternatives that were hanging off it. */
  async function detachAlt(activityId) {
    var alt = store.state.alt || {};
    if (alt[activityId]) await store.saveAlt(activityId, "");
    var kids = Object.keys(alt).filter(function (x) { return alt[x] === activityId; });
    if (kids.length) {
      await store.saveAlt(kids[0], "");
      for (var i = 1; i < kids.length; i++) await store.saveAlt(kids[i], kids[0]);
    }
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

  /* ================= money ================= */

  /* Everything is held in whole cents. Splitting by largest remainder means
     the shares always add back to the total — no stray cent, ever. */
  function splitCents(total, weights) {
    var names = Object.keys(weights || {}).filter(function (n) { return weights[n] > 0; });
    var sum = names.reduce(function (a, n) { return a + weights[n]; }, 0);
    if (!names.length || sum <= 0) return {};
    var parts = names.map(function (n) { return { n: n, exact: total * weights[n] / sum }; });
    var out = {}, given = 0;
    parts.forEach(function (p) { out[p.n] = Math.floor(p.exact); given += out[p.n]; });
    parts.sort(function (a, b) {
      return (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact));
    });
    for (var i = 0; i < total - given; i++) out[parts[i % parts.length].n] += 1;
    return out;
  }

  /** What each person owes on one expense, whichever way it was split. */
  function shareOf(e) {
    if (e.mode === "fixed") {
      var f = {};
      Object.keys(e.by || {}).forEach(function (n) { f[n] = Math.round(e.by[n]); });
      return f;
    }
    if (e.mode === "equal") {
      var w = {}, who = Object.keys(e.by || {});
      (who.length ? who : CFG.names).forEach(function (n) { w[n] = 1; });
      return splitCents(e.amount, w);
    }
    return splitCents(e.amount, e.by || {});   // units and share are both ratios
  }

  function expenses() {
    var x = store.state.expenses || {};
    return Object.keys(x).filter(function (k) { return x[k]; })
      .map(function (k) { return Object.assign({}, x[k], { id: k }); })
      .sort(function (a, b) { return String(b.date || b.when).localeCompare(String(a.date || a.when)); });
  }

  function eur(c) { return "€" + (c / 100).toFixed(2); }

  /** Net position per person: what they paid, minus what they owe. */
  function balances() {
    var net = {}, paid = {}, owed = {};
    CFG.names.forEach(function (n) { net[n] = 0; paid[n] = 0; owed[n] = 0; });
    expenses().forEach(function (e) {
      if (paid[e.paidBy] === undefined) return;
      paid[e.paidBy] += e.amount;
      var sh = shareOf(e);
      Object.keys(sh).forEach(function (n) { if (owed[n] !== undefined) owed[n] += sh[n]; });
    });
    CFG.names.forEach(function (n) { net[n] = paid[n] - owed[n]; });
    return { net: net, paid: paid, owed: owed };
  }

  /** Fewest transfers that clear the board: biggest debtor pays biggest creditor. */
  function settleUp(net) {
    var owe = [], get = [];
    Object.keys(net).forEach(function (n) {
      if (net[n] < 0) owe.push({ n: n, v: -net[n] });
      else if (net[n] > 0) get.push({ n: n, v: net[n] });
    });
    owe.sort(function (a, b) { return b.v - a.v; });
    get.sort(function (a, b) { return b.v - a.v; });
    var out = [], i = 0, j = 0;
    while (i < owe.length && j < get.length) {
      var amt = Math.min(owe[i].v, get[j].v);
      if (amt > 0) out.push({ from: owe[i].n, to: get[j].n, amount: amt });
      owe[i].v -= amt; get[j].v -= amt;
      if (owe[i].v === 0) i++;
      if (get[j].v === 0) j++;
    }
    return out;
  }

  var editing = null;      // expense id being edited, or "new", or null

  function renderMoney() {
    renderBase();
    renderBalances();
    renderAddForm();
    renderExpenseList();
  }

  /** Where we ended up, in one line — the voting is over. */
  function renderBase() {
    var box = el("moneyBase"), p = ourPlace();
    if (!box) return;
    if (!p) { box.innerHTML = ""; return; }
    var r = (p.lat && p.lng) ? rideTo(pt(p), null) : null;
    box.innerHTML =
      '<div class="basecard">' +
        '<div class="kick">Booked</div>' +
        "<b>" + esc(p.name) + "</b>" +
        '<div class="baseaddr">' + esc(p.full_address || p.area) + "</div>" +
        '<div class="basemeta">' + esc(p.checkin || "") +
          (p.checkout ? " → " + esc(p.checkout) : "") +
          (p.booking_ref ? " · booking " + esc(p.booking_ref) : "") + "</div>" +
        '<div class="links">' +
          '<button type="button" class="gotolink" data-goto="' + esc(p.id) + '">Get there</button>' +
          (r ? '<a href="' + r.maps + '" target="_blank" rel="noopener">Map</a>' : "") +
        "</div>" +
      "</div>";
  }

  function renderBalances() {
    var box = el("moneyBalances");
    if (!box) return;
    var b = balances(), list = expenses();
    var total = list.reduce(function (a, e) { return a + e.amount; }, 0);

    if (!list.length) {
      box.innerHTML = '<div class="sec-title">Where everyone stands</div>' +
        '<p class="sec-note">Nothing logged yet.</p>';
      return;
    }
    var rows = CFG.names.map(function (n) {
      var v = b.net[n];
      var state = v > 0 ? "up" : v < 0 ? "down" : "level";
      var says = v > 0 ? "is owed " + eur(v) : v < 0 ? "owes " + eur(-v) : "square";
      return '<div class="brow ' + state + (n === me ? " mine" : "") + '">' +
        '<span class="bwho"><b>' + esc(n) + "</b><small>paid " + eur(b.paid[n]) + " · share " + eur(b.owed[n]) + "</small></span>" +
        '<span class="bnet">' + esc(says) + "</span></div>";
    }).join("");

    var moves = settleUp(b.net).map(function (t) {
      return '<div class="settle"><b>' + esc(t.from) + "</b> → <b>" + esc(t.to) +
        "</b><span>" + eur(t.amount) + "</span></div>";
    }).join("");

    box.innerHTML =
      '<div class="sec-title">Where everyone stands</div>' +
      '<p class="sec-note">' + list.length + (list.length === 1 ? " expense" : " expenses") +
        ", " + eur(total) + " between us.</p>" +
      '<div class="balances">' + rows + "</div>" +
      (moves ? '<div class="sec-title">Settle up</div>' +
        '<p class="sec-note">Fewest transfers that clear it.</p>' +
        '<div class="settles">' + moves + "</div>" : "");
  }

  /** Snapshot whatever is typed, so a redraw doesn't lose it. */
  function captureDraft() {
    var box = el("moneyAdd");
    if (!box || !el("exTitle")) return;
    var d = box._draft || {};
    d.title = el("exTitle").value;
    d.amount = el("exAmount").value;
    d.date = el("exDate").value;
    d.by = d.by || {};
    CFG.names.forEach(function (n) {
      var tick = document.querySelector('.pin[data-who="' + n + '"]');
      var val = document.querySelector('.pval[data-val="' + n + '"]');
      if (tick) d.by[n] = { on: tick.checked, v: val ? val.value : (d.by[n] || {}).v };
    });
    box._draft = d;
  }

  function renderAddForm() {
    var box = el("moneyAdd");
    if (!box) return;
    if (!editing) {
      box.innerHTML = '<button type="button" class="btn big addexp" id="addExpense">+ Add an expense</button>';
      return;
    }
    var e = editing === "new" ? null : (store.state.expenses[editing] || null);
    var d = box._draft || {};
    var mode = box._mode || (e && e.mode) || "equal";
    var by = (e && e.by) || {};
    var nights = (TRIP.split && TRIP.split.nights) || {};

    var modes = (TRIP.split.modes || []).map(function (m) {
      return '<button type="button" class="mode' + (m.id === mode ? " on" : "") +
        '" data-mode="' + m.id + '">' + esc(m.label) + "</button>";
    }).join("");
    var hint = (TRIP.split.modes || []).filter(function (m) { return m.id === mode; })[0];

    var people = CFG.names.map(function (n) {
      var dr = (d.by || {})[n];
      var on = dr ? dr.on : (e ? (by[n] !== undefined && by[n] !== null) : (nights[n] > 0));
      var val = by[n] !== undefined ? by[n] : (mode === "units" ? (nights[n] || 0) : 0);
      if (mode === "fixed" && by[n] !== undefined) val = (by[n] / 100).toFixed(2);
      if (dr && dr.v !== undefined && dr.v !== null && dr.v !== "") val = dr.v;
      return '<label class="prow' + (on ? " on" : "") + '">' +
        '<input type="checkbox" class="pin" data-who="' + esc(n) + '"' + (on ? " checked" : "") + ">" +
        '<span class="pname">' + esc(n) + "</span>" +
        (mode === "equal" ? '<span class="pauto">even share</span>'
          : '<input class="pval" data-val="' + esc(n) + '" inputmode="decimal" value="' + esc(val) + '">' +
            '<span class="punit">' + (mode === "units" ? "units" : mode === "share" ? "%" : "€") + "</span>") +
      "</label>";
    }).join("");

    box.innerHTML =
      '<div class="expform">' +
        '<div class="sec-title" style="margin-top:0">' + (e ? "Edit expense" : "New expense") + "</div>" +
        '<div class="receiptrow">' +
          '<label class="btn ghost readbtn">Read a receipt' +
            '<input type="file" id="receiptFile" accept="image/*,application/pdf" hidden></label>' +
          '<span class="muted" style="font-size:11.5px">or fill it in yourself</span>' +
        "</div>" +
        '<input id="exTitle" maxlength="80" placeholder="What was it?" value="' + esc(d.title !== undefined ? d.title : (e ? e.title : "")) + '">' +
        '<div class="tworow">' +
          '<input id="exAmount" inputmode="decimal" placeholder="0.00" value="' + esc(d.amount !== undefined ? d.amount : (e ? (e.amount / 100).toFixed(2) : "")) + '">' +
          '<input id="exDate" type="date" value="' + esc(d.date !== undefined ? d.date : ((e && e.date) || new Date().toISOString().slice(0, 10))) + '">' +
        "</div>" +
        '<div class="fieldlabel">Who paid</div>' +
        '<div class="payers">' + CFG.names.map(function (n) {
          var on = (box._payer || (e ? e.paidBy : me)) === n;
          return '<button type="button" class="payer' + (on ? " on" : "") + '" data-payer="' + esc(n) + '">' + esc(n) + "</button>";
        }).join("") + "</div>" +
        '<div class="fieldlabel">How to split</div>' +
        '<div class="modes">' + modes + "</div>" +
        (hint ? '<p class="modehint">' + esc(hint.hint) + "</p>" : "") +
        '<div class="people">' + people + "</div>" +
        '<div class="splitpreview" id="splitPreview"></div>' +
        '<div class="pfrow">' +
          '<button type="button" class="btn dim" id="exCancel">Cancel</button>' +
          (e ? '<button type="button" class="btn dim del" id="exDelete">Delete</button>' : "") +
          '<button type="button" class="btn" id="exSave">' + (e ? "Save" : "Add it") + "</button>" +
        "</div>" +
      "</div>";
    box._mode = mode;
    box._payer = box._payer || (e ? e.paidBy : me);
    updatePreview();
  }

  /** Read the form back out, in the shape the store wants. */
  function readForm() {
    var box = el("moneyAdd");
    var mode = box._mode || "equal";
    var amount = Math.round(parseFloat((el("exAmount").value || "0").replace(",", ".")) * 100);
    var by = {};
    CFG.names.forEach(function (n) {
      var tick = document.querySelector('.pin[data-who="' + n + '"]');
      if (!tick || !tick.checked) return;
      if (mode === "equal") { by[n] = 1; return; }
      var f = document.querySelector('.pval[data-val="' + n + '"]');
      var v = parseFloat(((f && f.value) || "0").replace(",", ".")) || 0;
      by[n] = mode === "fixed" ? Math.round(v * 100) : v;
    });
    return {
      title: (el("exTitle").value || "").trim().slice(0, 80),
      amount: isNaN(amount) ? 0 : amount,
      currency: (TRIP.split && TRIP.split.currency) || "EUR",
      paidBy: box._payer || me,
      date: el("exDate").value || "",
      mode: mode, by: by
    };
  }

  function updatePreview() {
    var box = el("splitPreview");
    if (!box) return;
    var f = readForm();
    if (!f.amount) { box.innerHTML = '<span class="muted">Enter an amount to see the split.</span>'; return; }
    var sh = shareOf(f);
    var sum = Object.keys(sh).reduce(function (a, n) { return a + sh[n]; }, 0);
    var off = sum - f.amount;
    box.innerHTML = Object.keys(sh).map(function (n) {
      return '<span class="pv"><b>' + esc(n) + "</b> " + eur(sh[n]) + "</span>";
    }).join("") +
      (off ? '<div class="offby">Adds up to ' + eur(sum) + " — that is " +
        (off > 0 ? eur(off) + " over" : eur(-off) + " short") + " of the total.</div>" : "");
  }

  async function saveExpenseForm() {
    var f = readForm();
    if (!f.title) { toast("Give it a name"); return; }
    if (!f.amount) { toast("Enter an amount"); return; }
    if (!Object.keys(f.by).length) { toast("Nobody is on this expense"); return; }
    if (f.mode === "fixed") {
      var sum = Object.keys(f.by).reduce(function (a, n) { return a + f.by[n]; }, 0);
      if (sum !== f.amount) { toast("Exact amounts add up to " + eur(sum) + ", not " + eur(f.amount) + "."); return; }
    }
    f.id = editing === "new" ? "e" + Date.now().toString(36) : editing;
    var res = await store.saveExpense(f);
    editing = null;
    el("moneyAdd")._mode = null;
    el("moneyAdd")._payer = null;
    el("moneyAdd")._draft = null;
    renderMoney();
    toast(res.synced ? "Saved — everyone sees it now." : "Couldn't save. Check you're online.", 3500);
  }

  async function deleteExpenseForm() {
    var id = editing;
    editing = null;
    el("moneyAdd")._mode = null;
    el("moneyAdd")._payer = null;
    el("moneyAdd")._draft = null;
    if (id && id !== "new") await store.deleteExpense(id);
    renderMoney();
    if (id && id !== "new") toast("Deleted.", 2000);
  }

  function renderExpenseList() {
    var box = el("moneyList");
    if (!box) return;
    var list = expenses();
    if (!list.length) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="sec-title">Everything logged</div>' +
      '<div class="exlist">' + list.map(function (e) {
        var sh = shareOf(e);
        var modeName = ((TRIP.split.modes || []).filter(function (m) { return m.id === e.mode; })[0] || {}).label || e.mode;
        return '<div class="exrow">' +
          '<div class="exhead"><b>' + esc(e.title) + "</b><span>" + eur(e.amount) + "</span></div>" +
          '<div class="exmeta">' + esc(e.paidBy) + " paid · " + esc(modeName) +
            (e.date ? " · " + esc(e.date) : "") + "</div>" +
          '<div class="exshares">' + Object.keys(sh).map(function (n) {
            return '<span class="pv"><b>' + esc(n) + "</b> " + eur(sh[n]) + "</span>";
          }).join("") + "</div>" +
          (e.note ? '<div class="exnote">' + esc(e.note) + "</div>" : "") +
          '<div class="exacts"><button type="button" class="mini" data-editex="' + esc(e.id) + '">Edit</button></div>' +
        "</div>";
      }).join("") + "</div>";
  }

  /* Reads a receipt through the Worker that already holds the API key, the same
     way Winyle does. That route isn't there yet, so say so rather than fail mutely. */
  async function readReceipt(file) {
    var cfg = (TRIP.split && TRIP.split.receipt) || {};
    if (!cfg.endpoint) { toast("No receipt reader configured."); return; }
    toast("Reading the receipt…", 20000);
    var b64;
    try {
      b64 = await new Promise(function (res, rej) {
        var r = new FileReader();
        r.onerror = rej;
        r.onload = function () { res(String(r.result).split(",")[1]); };
        r.readAsDataURL(file);
      });
    } catch (err) { toast("Couldn't read that file."); return; }

    var r;
    try {
      r = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mediaType: file.type, data: b64 })
      });
    } catch (err) {
      toast("Couldn't reach the reader. Type it in instead.", 5000);
      return;
    }
    if (r.status === 404) {
      toast("The reader route isn't on the Worker yet — type it in for now.", 6000);
      return;
    }
    if (!r.ok) { toast("Reader returned " + r.status + ". Type it in instead.", 5000); return; }

    var j = null;
    try { j = await r.json(); } catch (err) {}
    if (!j || (!j.amount && !j.title)) { toast("Nothing readable came back. Type it in.", 5000); return; }
    if (j.title) el("exTitle").value = String(j.title).slice(0, 80);
    if (j.amount) el("exAmount").value = (Math.round(Number(j.amount) * 100) / 100).toFixed(2);
    if (j.date && /^\d{4}-\d{2}-\d{2}$/.test(j.date)) el("exDate").value = j.date;
    updatePreview();
    toast("Filled in from the receipt — check it before saving.", 5000);
  }

  /* ================= INFO ================= */

  function renderInfo() {
    var A = TRIP.airport;
    var deflist = function (arr) {
      return '<div class="deflist">' + arr.map(function (x) {
        return '<div class="d"><b>' + esc(x.t) + "</b><span>" + esc(x.d) + "</span></div>";
      }).join("") + "</div>";
    };

    renderWeather();
    renderYou();
    renderStaySummary();
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
    return view === "picks" ? "picks" : null;   // money has no running count
  }

  function updateBar() {
    var kind = activeKind();
    var bar = el("submitbar");
    if (!kind || !me) { bar.classList.remove("on"); return; }
    bar.classList.add("on");
    el("pickCount").textContent = Object.keys(sel[kind]).length;
    el("pickWord").textContent = "picked";
  }

  function labelsFor(kind) {
    var ids = Object.keys(sel[kind]);
    return ids.map(function (id) {
      if (byId[id]) return byId[id].item.name;
      var c = store.state.customs.filter(function (x) { return x.id === id; })[0];
      return c ? c.name + " *" : id;
    });
  }



  boot();
})();
