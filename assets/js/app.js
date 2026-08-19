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
  var sel = { picks: {} };
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
        fetch("data/venues.json?v=mt0ldvz2").then(function (r) { return r.json(); }),
        fetch("data/trip.json?v=mt0ldvz2").then(function (r) { return r.json(); })
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
      sel = { picks: {} };
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

      var sl = e.target.closest("[data-slot]");
      if (sl) { setSlot(sl.getAttribute("data-for"), sl.getAttribute("data-slot")); return; }

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
    sel = { picks: {} };
    var pk = store.state.picks[name];
    if (pk && pk.ids) pk.ids.forEach(function (id) { sel.picks[id] = true; });

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
    renderClash();
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
      // Anything slotted into one of this day's bands, under the fixed points.
      var dayName = d.day + " " + parseInt(d.date.slice(8), 10);
      var bands = (TRIP.slots || []).filter(function (s) { return s.day === dayName; })
        .map(function (s) {
          var got = plannedIn(s.id);
          if (!got.length) return "";
          return '<div class="slot planned"><div class="st">' + esc(s.when) + "</div>" +
            '<div class="sd">' + got.map(function (id) {
              return '<span class="ptag">' + esc(nameOf(id)) + "</span>";
            }).join("") + "</div></div>";
        }).join("");

      return '<div class="day"><div class="dhead"><b>' + esc(d.day) + " " +
        esc(d.date.slice(8)) + " Aug</b><span>" + esc(d.label) + "</span></div>" +
        slots + bands + "</div>";
    }).join("");
    el("homeSchedule").innerHTML = html;
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
    var card = e.target.closest("[data-pick]");
    if (card) { toggle("picks", card.getAttribute("data-pick")); return; }
  }

  function toggle(kind, id) {
    if (!me) return;
    if (sel[kind][id]) delete sel[kind][id]; else sel[kind][id] = true;
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
    renderClash();
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
      var all = voted.length > 1 && v.length === voted.length;
      w.innerHTML = v.map(function (n) {
        return '<span class="' + (all ? "all" : (n === me ? "n" : "")) + '">' + esc(n) + "</span>";
      }).join("");
    });
  }

  function paintWho() {
    document.querySelectorAll(".who").forEach(function (w) { w.innerHTML = ""; });
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

    // Built like the other sections so it doesn't read as an orphan block.
    box.innerHTML = "<section>" +
      '<div class="cathead"><h3>The tally</h3><span>' + rows.length + " with votes</span></div>" +
      '<p class="catnote">★ = everyone who has voted so far picked it. Tap any row to jump to it.</p>' +
      '<div class="rank">' + rows.map(function (r, i) {
        var bars = CFG.names.map(function (n) {
          return '<i class="' + (r.who.indexOf(n) > -1 ? "f" : "") + '"></i>';
        }).join("");
        var unan = voted.length > 1 && r.n === voted.length;
        var slot = slotById((store.state.plan || {})[r.id]);
        return '<div class="rwrap">' +
          '<button type="button" class="r' + (unan ? " unan" : "") + '" data-jump="' + esc(r.id) + '">' +
            '<span class="n">' + (i + 1) + "</span>" +
            '<span class="nm"><b>' + esc(r.name) + "</b>" +
              (r.what ? '<i class="what">' + esc(r.what) + "</i>" : "") +
              (slot ? '<i class="slotted">' + esc(slot.day) + " · " + esc(slot.when) + "</i>" : "") +
              "<small>" + esc(r.who.join(", ")) + "</small></span>" +
            '<span class="bars">' + bars + "</span>" +
          "</button>" +
          (canPlan()
            ? '<button type="button" class="slotadd' + (slot ? " on" : "") +
              '" data-plan="' + esc(r.id) + '" title="Put this in a slot">' + (slot ? "✎" : "+") + "</button>"
            : "") +
        "</div>";
      }).join("") + "</div></section>";
  }


  /* ---- slotting activities into the days ---- */

  function slotById(id) {
    return (TRIP.slots || []).filter(function (s) { return s.id === id; })[0] || null;
  }
  function nameOf(id) {
    if (byId[id]) return byId[id].item.name;
    var c = store.state.customs.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : id;
  }
  /** Everything slotted into one band, in the order the tally ranks them. */
  function plannedIn(slotId) {
    var p = store.state.plan || {};
    return Object.keys(p).filter(function (id) { return p[id] === slotId; });
  }

  /* Only the planner gets to move things about — everyone else just sees where
     they landed. There is no auth behind this, so it is a tidiness measure
     rather than a lock. */
  function canPlan() { return me === (CFG.planner || CFG.uploader); }

  function openSlotPicker(activityId) {
    var cur = (store.state.plan || {})[activityId] || "";
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
            return '<button type="button" class="slotbtn' + (cur === s.id ? " on" : "") +
              '" data-slot="' + esc(s.id) + '" data-for="' + esc(activityId) + '">' +
              '<span class="slotwhen">' + esc(s.when) + "</span>" +
              (s.note ? '<span class="slotnote">' + esc(s.note) + "</span>" : "") +
              (here.length ? '<span class="slothas">already here: ' +
                esc(here.map(nameOf).join(", ")) + "</span>" : "") +
            "</button>";
          }).join("") + "</div>";
      }).join("") +
      (cur ? '<button type="button" class="btn dim clearslot" data-slot="" data-for="' +
        esc(activityId) + '">Take it off the plan</button>' : "") +
      "</div>";
    el("sheet").hidden = false;
    document.body.style.overflow = "hidden";
  }

  async function setSlot(activityId, slotId) {
    await store.savePlan(activityId, slotId);
    closeSheet();
    renderSummary();
    renderSchedule();
    toast(slotId
      ? nameOf(activityId) + " → " + (slotById(slotId) || {}).day + ", " + (slotById(slotId) || {}).when
      : "Taken off the plan", 3000);
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
