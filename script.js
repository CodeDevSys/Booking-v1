(function () {
  "use strict";

  const DEFAULT_SERVICE = "Haare schneiden";
  const DEFAULT_STAFF = "Sophie";
  const SLOT_MINUTES = 60;
  const BUSINESS_START = 9;
  const BUSINESS_END = 17;

  const state = {
    step: 1,
    service: DEFAULT_SERVICE,
    staff: DEFAULT_STAFF,
    date: null,
    slot: null,
    offlineMode: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function toDateInputValue(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseLocalDate(dateStr) {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatTimeLabel(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatDateLabel(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("de-DE", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function showStep(n) {
    state.step = n;
    $$(".panel").forEach((p) => p.classList.remove("active"));
    const panel = $(`#panel-${n === "success" ? "success" : n}`);
    if (panel) panel.classList.add("active");

    $$(".step").forEach((s) => {
      const num = Number(s.dataset.step);
      if (n === "success") {
        s.classList.remove("active");
        s.classList.add("done");
        return;
      }
      s.classList.toggle("active", num === n);
      s.classList.toggle("done", typeof n === "number" && num < n);
    });
  }

  function showError(msg) {
    const existing = $(".error-toast");
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = "error-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  async function apiFetch(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
        throw new Error("API nicht verfügbar");
      }
      throw new Error("Ungültige Serverantwort");
    }
    return { res, data };
  }

  function generateClientSlots(dateStr) {
    const day = parseLocalDate(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day < today || day.getDay() === 0 || day.getDay() === 6) return [];

    const slots = [];
    const start = new Date(day);
    start.setHours(BUSINESS_START, 0, 0, 0);
    const end = new Date(day);
    end.setHours(BUSINESS_END, 0, 0, 0);
    const now = Date.now();

    for (let t = new Date(start); t < end; t = new Date(t.getTime() + SLOT_MINUTES * 60000)) {
      if (t.getTime() <= now) continue;
      slots.push({
        start: t.toISOString(),
        end: new Date(t.getTime() + SLOT_MINUTES * 60000).toISOString(),
        label: formatTimeLabel(t),
      });
    }
    return slots;
  }

  function renderSlots(slots, emptyMessage = "Für dieses Datum sind keine Termine verfügbar. Bitte wähle ein anderes Datum.") {
    const grid = $("#slots-grid");
    const timeNext = $("#time-next");
    grid.innerHTML = "";
    state.slot = null;
    timeNext.disabled = true;

    if (!slots.length) {
      grid.innerHTML = `<p class="empty">${emptyMessage}</p>`;
      return;
    }

    slots.forEach((slot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";
      btn.textContent = slot.label;
      btn.dataset.start = slot.start;
      btn.addEventListener("click", () => {
        $$(".slot-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        state.slot = slot;
        timeNext.disabled = false;
      });
      grid.appendChild(btn);
    });
  }

  function initDateInput() {
    const input = $("#date-input");
    if (!input) return;

    const today = new Date();
    input.min = toDateInputValue(today);
    const max = new Date(today);
    max.setDate(max.getDate() + 60);
    input.max = toDateInputValue(max);

    input.addEventListener("change", async () => {
      state.date = input.value;
      state.slot = null;
      const next = $("#date-next");
      const hint = $("#date-hint");

      if (!state.date) {
        next.disabled = true;
        renderSlots([], "Wähle ein Datum, um verfügbare Zeiten zu sehen.");
        return;
      }

      const day = new Date(state.date + "T12:00:00").getDay();
      if (day === 0 || day === 6) {
        hint.textContent = "Am Wochenende sind keine Termine verfügbar. Bitte wähle einen Wochentag.";
        next.disabled = true;
        state.date = null;
        renderSlots([], "Wähle einen verfügbaren Wochentag, um Zeiten zu sehen.");
        return;
      }

      hint.textContent = formatDateLabel(state.date);
      next.disabled = false;
      showStep(3);
      await loadSlots(state.date);
    });
  }

  async function loadSlots(dateStr = state.date) {
    const grid = $("#slots-grid");
    const label = $("#selected-date-label");
    if (!grid || !label || !dateStr) return;

    label.textContent = formatDateLabel(dateStr);
    grid.innerHTML = '<p class="loading">Zeiten werden geladen…</p>';
    state.slot = null;
    const timeNext = $("#time-next");
    if (timeNext) timeNext.disabled = true;

    let slots = [];
    try {
      const params = new URLSearchParams({
        date: dateStr,
        tzOffset: String(new Date().getTimezoneOffset()),
      });
      const { res, data } = await apiFetch(`/api/slots?${params.toString()}`);
      if (!res.ok) throw new Error(data.error || "Zeiten konnten nicht geladen werden");
      slots = Array.isArray(data.slots) ? data.slots : [];
      state.offlineMode = false;
    } catch {
      slots = generateClientSlots(dateStr);
      state.offlineMode = true;
      showError("Demo-Modus: Zeiten werden lokal angezeigt. Verbinde die API, um Termine auf dem Server zu speichern.");
    }

    if (dateStr !== state.date) return;
    renderSlots(slots);
  }

  function updateSummary() {
    const el = $("#booking-summary");
    if (!el || !state.slot) return;
    el.innerHTML = `
      <dl>
        <dt>Service</dt><dd>${state.service}</dd>
        <dt>Mitarbeiter</dt><dd>${state.staff}</dd>
        <dt>Datum</dt><dd>${formatDateLabel(state.date)}</dd>
        <dt>Uhrzeit</dt><dd>${state.slot.label}</dd>
      </dl>
    `;
  }

  async function submitBooking(e) {
    e.preventDefault();
    if (!state.slot) {
      showError("Bitte wähle vor dem Bestätigen eine Uhrzeit aus.");
      return;
    }
    const form = e.target;
    const btn = $("#submit-btn");
    const fd = new FormData(form);
    const payload = {
      date: state.date,
      start: state.slot.start,
      name: String(fd.get("name")).trim(),
      email: String(fd.get("email")).trim(),
      notes: fd.get("notes"),
      service: state.service,
      staff: state.staff,
    };

    btn.disabled = true;
    btn.textContent = "Wird gebucht…";

    try {
      if (!state.offlineMode) {
        const { res, data } = await apiFetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(data.error || "Buchung fehlgeschlagen");
      } else {
        const list = JSON.parse(localStorage.getItem("bookings") || "[]");
        list.push({ ...payload, id: Date.now(), savedAt: new Date().toISOString() });
        localStorage.setItem("bookings", JSON.stringify(list));
      }

      const msg = state.offlineMode
        ? `${state.service} bei ${state.staff} am ${formatDateLabel(state.date)} um ${state.slot.label}. Auf diesem Gerät gespeichert (Demo).`
        : `${state.service} bei ${state.staff} am ${formatDateLabel(state.date)} um ${state.slot.label}. Bestätigung an ${payload.email} gesendet.`;

      $("#success-message").textContent = msg;
      showStep("success");
    } catch (err) {
      showError(err.message || "Buchung fehlgeschlagen");
    } finally {
      btn.disabled = false;
      btn.textContent = "Buchung bestätigen";
    }
  }

  function resetBooking() {
    state.service = DEFAULT_SERVICE;
    state.staff = DEFAULT_STAFF;
    state.date = null;
    state.slot = null;
    state.offlineMode = false;
    const dateInput = $("#date-input");
    if (dateInput) dateInput.value = "";
    $("#date-hint").textContent = "";
    $("#date-next").disabled = true;
    $("#time-next").disabled = true;
    $$(".service-btn").forEach((b) => {
      b.classList.toggle("selected", b.dataset.service === DEFAULT_SERVICE);
    });
    $$(".staff-btn").forEach((b) => {
      b.classList.toggle("selected", b.dataset.staff === DEFAULT_STAFF);
    });
    $("#details-form").reset();
    showStep(1);
  }

  function setupNavigation() {
    $$(".next-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const next = Number(btn.dataset.next);
        if (next === 3 && state.date) await loadSlots();
        if (next === 4) {
          if (!state.slot) {
            showError("Bitte wähle vor dem Fortfahren eine Uhrzeit aus.");
            return;
          }
          updateSummary();
        }
        showStep(next);
      });
    });

    $$(".back-btn").forEach((btn) => {
      btn.addEventListener("click", () => showStep(Number(btn.dataset.back)));
    });
  }

  function setupServices() {
    $$(".service-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".service-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        state.service = btn.dataset.service;
      });
    });
  }

  function setupStaff() {
    $$(".staff-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".staff-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        state.staff = btn.dataset.staff;
      });
    });
  }

  const ADMIN_USER_STORAGE = "booking_admin_user";
  const ADMIN_STORAGE = "booking_admin_key";
  const adminState = {
    bookings: [],
    waitlist: { entries: [], offers: [], notifications: [] },
  };

  function escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = String(text);
    return d.innerHTML;
  }

  function formatBookingDate(start) {
    if (!start) return "—";
    return new Date(start).toLocaleDateString("de-DE", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatBookingTime(start) {
    if (!start) return "—";
    return new Date(start).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDateTime(start) {
    if (!start) return "—";
    return `${formatBookingDate(start)}, ${formatBookingTime(start)}`;
  }

  function statusLabel(status) {
    const labels = {
      active: "Aktiv",
      pending: "Angeboten",
      open: "Offen",
      booked: "Gebucht",
      expired: "Abgelaufen",
      unavailable: "Vergeben",
      superseded: "Überholt",
      delivered: "Zugestellt",
      accepted: "Angenommen",
      declined: "Abgelehnt",
    };
    return labels[status] || status || "—";
  }

  function statusPill(status) {
    const safe = escapeHtml(status || "");
    return `<span class="status-pill ${safe}">${escapeHtml(statusLabel(status))}</span>`;
  }

  function waitlistAvailability(entry) {
    const parts = [];
    if (entry.preferredDate) parts.push(formatDateLabel(entry.preferredDate));
    if (entry.earliestTime || entry.latestTime) {
      parts.push(`${entry.earliestTime || "00:00"}–${entry.latestTime || "23:59"}`);
    }
    if (entry.staffPreference) parts.push(`Mitarbeiter: ${entry.staffPreference}`);
    return parts.length ? parts.join(" · ") : "Flexibel";
  }

  function demoBookingForSlot(bookings, slotKey) {
    const ids = {
      "10:00": "demo-booking-1000",
      "11:00": "demo-booking-1100",
      "14:00": "demo-booking-cancel",
      "16:00": "demo-booking-1600",
    };
    if (slotKey === "14:00") {
      return bookings.find((booking) => booking.waitlistEntryId) ||
        bookings.find((booking) => booking.id === ids[slotKey]);
    }
    return bookings.find((booking) => booking.id === ids[slotKey]);
  }

  function renderDemoDashboard() {
    const container = $("#demo-dashboard");
    if (!container) return;

    const bookings = adminState.bookings || [];
    const waitlist = adminState.waitlist || {};
    const entries = waitlist.entries || [];
    const offers = waitlist.offers || [];
    const notifications = waitlist.notifications || waitlist.messages || [];
    const cancelledBooking = bookings.find((booking) => booking.id === "demo-booking-cancel");
    const rescuedBooking = bookings.find((booking) => booking.waitlistEntryId);
    const anna = entries.find((entry) => entry.id === "demo-entry-anna") || entries.find((entry) => entry.name?.includes("Anna"));
    const annaOffer = offers.find((offer) => offer.entryId === anna?.id);
    const annaNotification = notifications.find((notification) => notification.entryId === anna?.id);
    const slot14Empty = !cancelledBooking && !rescuedBooking;
    const slot14Saved = !!rescuedBooking;

    const slotRows = [
      { time: "10:00", label: "Haarschnitt", booking: demoBookingForSlot(bookings, "10:00") },
      { time: "11:00", label: "Farbe", booking: demoBookingForSlot(bookings, "11:00") },
      { time: "14:00", label: "Farbe", booking: demoBookingForSlot(bookings, "14:00"), rescueSlot: true },
      { time: "15:00", label: "frei", booking: null },
      { time: "16:00", label: "Haarschnitt", booking: demoBookingForSlot(bookings, "16:00") },
    ];

    const calendarHtml = slotRows.map((slot) => {
      const isEmptyRescue = slot.rescueSlot && slot14Empty;
      const isSaved = slot.rescueSlot && slot14Saved;
      const status = isSaved ? "saved" : isEmptyRescue ? "loss" : slot.booking ? "booked" : "free";
      const title = isSaved
        ? `${slot.label} - ${rescuedBooking.name}`
        : isEmptyRescue
          ? "Leerstand nach Absage"
          : slot.booking
            ? `${slot.label} - ${slot.booking.name}`
            : "Freier Puffer";
      const action = slot.rescueSlot && cancelledBooking
        ? `<button type="button" class="btn primary small delete-booking-btn" data-id="${encodeURIComponent(cancelledBooking.id)}" data-source="${escapeHtml(cancelledBooking.source || "server")}">Termin absagen</button>`
        : "";
      return `<div class="calendar-slot ${status}">
        <div class="slot-time">${slot.time}</div>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <p>${status === "loss" ? "Problem: Umsatzverlust" : status === "saved" ? "Gerettet durch Warteliste" : escapeHtml(slot.booking?.staff || "Sophie")}</p>
        </div>
        ${action}
      </div>`;
    }).join("");

    const systemStatus = slot14Saved
      ? "Slot geschlossen: Anna hat übernommen."
      : annaOffer
        ? "Beste Übereinstimmung gefunden: Anna kann vorgezogen werden."
        : slot14Empty
          ? "System wartet auf Kundenreaktion."
          : "Bereit: Absage bei 14:00 starten.";

    container.innerHTML = `
      <div class="impact-grid">
        <div class="impact-card danger">
          <span>Vorher</span>
          <strong>14:00 ${slot14Empty ? "leer" : "gefährdet"}</strong>
          <p>Ein leerer Farbschnitt-Slot bedeutet direkten Umsatzverlust.</p>
        </div>
        <div class="impact-card success">
          <span>Nachher</span>
          <strong>14:00 ${slot14Saved ? "Termin gerettet" : "Warteliste bereit"}</strong>
          <p>${slot14Saved ? "Der Kalender ist wieder gefüllt." : "Das System sucht automatisch den besten Ersatz."}</p>
        </div>
      </div>

      <div class="demo-columns">
        <div>
          <h3>Salon-Kalender</h3>
          <div class="calendar-demo">${calendarHtml}</div>
        </div>
        <div>
          <h3>Automatisches Planungssystem</h3>
          <div class="system-panel">
            <div class="system-line ok"><span></span>Service passt: Farbe</div>
            <div class="system-line ok"><span></span>Dauer passt: 60 Minuten</div>
            <div class="system-line ok"><span></span>Mitarbeiter verfügbar: Sophie</div>
            <div class="system-line ok"><span></span>Kunde möchte früher kommen: Anna, 17:00 → 14:00</div>
            <div class="match-result">
              <span>Matching-Ergebnis</span>
              <strong>${escapeHtml(systemStatus)}</strong>
              <p>${annaNotification ? "Mock-WhatsApp wurde in der Demo-Inbox erstellt." : "Klicke auf „Termin absagen“, um die Automation live zu zeigen."}</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function getLocalBookings() {
    try {
      const local = JSON.parse(localStorage.getItem("bookings") || "[]");
      return Array.isArray(local)
        ? local.map((b) => ({
            ...b,
            id: b.id || `${b.start || ""}-${b.email || ""}`,
            source: "browser",
          }))
        : [];
    } catch {
      return [];
    }
  }

  function mergeBookings(serverBookings, localBookings) {
    const seen = new Set();
    return [...serverBookings, ...localBookings]
      .filter((booking) => {
        const key = booking.id || `${booking.start || ""}-${booking.email || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(a.start || 0).getTime() - new Date(b.start || 0).getTime());
  }

  function renderAdminBookings(bookings) {
    const container = $("#bookings-container");
    const count = $("#count-label");
    if (!container) return;

    if (!bookings.length) {
      container.innerHTML = '<p class="empty">Noch keine Termine gebucht.</p>';
      if (count) count.textContent = "0 Termine";
      return;
    }

    if (count) {
      count.textContent = `${bookings.length} Termin${bookings.length === 1 ? "" : "e"}`;
    }

    const rows = bookings
      .map(
        (b) => `<tr>
        <td>${formatBookingDate(b.start)}</td>
        <td>${formatBookingTime(b.start)}</td>
        <td>${escapeHtml(b.service || "—")}</td>
        <td>${escapeHtml(b.staff || "—")}</td>
        <td>${escapeHtml(b.name || "—")}</td>
        <td>${escapeHtml(b.email || "—")}</td>
        <td>${escapeHtml(b.notes || "—")}</td>
        <td><button type="button" class="btn ghost small delete-booking-btn" data-id="${encodeURIComponent(String(b.id || ""))}" data-source="${escapeHtml(b.source || "server")}" ${b.id ? "" : "disabled"}>Absage simulieren</button></td>
      </tr>`
      )
      .join("");

    container.innerHTML = `<div class="table-wrap"><table class="bookings-table">
        <thead><tr><th>Datum</th><th>Uhrzeit</th><th>Service</th><th>Mitarbeiter</th><th>Kunde</th><th>E-Mail</th><th>Notizen</th><th>Aktion</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  function renderWaitlist(data) {
    const container = $("#waitlist-container");
    if (!container) return;

    const entries = Array.isArray(data.entries) ? data.entries : [];
    const offers = Array.isArray(data.offers) ? data.offers : [];
    const notifications = Array.isArray(data.notifications) ? data.notifications : (data.messages || []);

    const entriesHtml = entries.length
      ? `<div class="table-wrap"><table class="bookings-table">
          <thead><tr><th>Status</th><th>Kunde</th><th>Service</th><th>Dauer</th><th>Verfügbarkeit</th><th>Priorität</th></tr></thead>
          <tbody>${entries
            .map(
              (entry) => `<tr>
                <td>${statusPill(entry.status)}</td>
                <td>${escapeHtml(entry.name || "—")}<br><span class="hint">${escapeHtml(entry.phone || "—")}</span></td>
                <td>${escapeHtml(entry.service || "—")}</td>
                <td>${escapeHtml(entry.durationMinutes || "—")} Min.</td>
                <td>${escapeHtml(waitlistAvailability(entry))}</td>
                <td>${escapeHtml(entry.ranking || 0)}</td>
              </tr>`
            )
            .join("")}</tbody>
        </table></div>`
      : '<p class="empty">Noch keine Kunden auf der Warteliste.</p>';

    const offersHtml = offers.length
      ? `<div class="table-wrap"><table class="bookings-table">
          <thead><tr><th>Status</th><th>Termin</th><th>Strategie</th><th>Ablauf</th></tr></thead>
          <tbody>${offers
            .slice(0, 10)
            .map(
              (offer) => `<tr>
                <td>${statusPill(offer.status)}</td>
                <td>${escapeHtml(formatDateTime(offer.slot?.start))}</td>
                <td>${escapeHtml(offer.strategy === "cascade" ? "Kaskade" : "First-Come")}</td>
                <td>${escapeHtml(formatDateTime(offer.expiresAt))}</td>
              </tr>`
            )
            .join("")}</tbody>
        </table></div>`
      : '<p class="empty">Noch keine automatischen Angebote erzeugt.</p>';

    const inboxHtml = notifications.length
      ? `<div class="notification-list">${notifications
          .slice(0, 10)
          .map((notification) => {
            const offer = offers.find((item) => item.id === notification.offerId);
            const canAct = notification.status === "delivered" && (!offer || offer.status === "pending");
            return `<article class="whatsapp-card">
              <div class="whatsapp-head">
                <span>WhatsApp-Demo an ${escapeHtml(notification.customerName || notification.to || "Kunde")}</span>
                ${statusPill(notification.status)}
              </div>
              <pre>${escapeHtml(notification.message || "")}</pre>
              <div class="whatsapp-actions">
                <button type="button" class="btn primary small take-notification-btn" data-token="${encodeURIComponent(notification.token || "")}" ${canAct ? "" : "disabled"}>${escapeHtml(notification.actionLabel || "Termin übernehmen")}</button>
                <button type="button" class="btn ghost small decline-notification-btn" data-token="${encodeURIComponent(notification.token || "")}" ${canAct ? "" : "disabled"}>${escapeHtml(notification.declineLabel || "Nein danke")}</button>
              </div>
            </article>`;
          })
          .join("")}</div>`
      : '<p class="empty">Noch keine Demo-Notifications. Simuliere eine Absage, um hier die WhatsApp-ähnliche Nachricht zu sehen.</p>';

    container.innerHTML = `
      <div class="waitlist-section">
        <h3>Aktive Warteliste (${entries.length})</h3>
        ${entriesHtml}
      </div>
      <div class="waitlist-section">
        <h3>Automatische Angebote</h3>
        ${offersHtml}
      </div>
      <div class="waitlist-section">
        <h3>Demo-Inbox: simulierte WhatsApp-Nachrichten</h3>
        ${inboxHtml}
      </div>
    `;
  }

  function setAdminStatus(message, type) {
    const el = $("#admin-status");
    if (!el) return;
    el.textContent = message || "";
    el.className = "admin-status" + (type ? ` ${type}` : "");
  }

  async function loadAdminBookings() {
    const user = sessionStorage.getItem(ADMIN_USER_STORAGE) || "";
    const key = sessionStorage.getItem(ADMIN_STORAGE) || "";
    const container = $("#bookings-container");
    if (!container) return;
    container.innerHTML = '<p class="loading">Termine werden geladen…</p>';

    try {
      const params = new URLSearchParams({ user, key });
      const { res, data } = await apiFetch(`/api/bookings?${params.toString()}`);
      if (res.status === 401 || res.status === 503) {
        sessionStorage.removeItem(ADMIN_USER_STORAGE);
        sessionStorage.removeItem(ADMIN_STORAGE);
        showAdminLogin();
        setAdminStatus(data.error || "Falscher Benutzername oder falsches Passwort.", "error");
        return false;
      }
      if (!res.ok) throw new Error(data.error || "Termine konnten nicht geladen werden");
      const bookings = mergeBookings(data.bookings || [], getLocalBookings());
      adminState.bookings = bookings;
      renderAdminBookings(bookings);
      renderDemoDashboard();
      setAdminStatus("", "");
      return true;
    } catch (err) {
      const local = getLocalBookings();
      if (local.length) {
        adminState.bookings = local;
        renderAdminBookings(local);
        renderDemoDashboard();
        setAdminStatus(
          "API nicht verfügbar — zeige in diesem Browser gespeicherte Termine.",
          "error"
        );
        return true;
      }
      container.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      setAdminStatus(err.message, "error");
      return false;
    }
  }

  async function loadWaitlist() {
    const user = sessionStorage.getItem(ADMIN_USER_STORAGE) || "";
    const key = sessionStorage.getItem(ADMIN_STORAGE) || "";
    const container = $("#waitlist-container");
    if (!container) return false;
    container.innerHTML = '<p class="loading">Warteliste wird geladen…</p>';

    try {
      const params = new URLSearchParams({ user, key });
      const { res, data } = await apiFetch(`/api/waitlist?${params.toString()}`);
      if (res.status === 401 || res.status === 503) {
        sessionStorage.removeItem(ADMIN_USER_STORAGE);
        sessionStorage.removeItem(ADMIN_STORAGE);
        showAdminLogin();
        setAdminStatus(data.error || "Falscher Benutzername oder falsches Passwort.", "error");
        return false;
      }
      if (!res.ok) throw new Error(data.error || "Warteliste konnte nicht geladen werden");
      adminState.waitlist = data;
      renderWaitlist(data);
      renderDemoDashboard();
      return true;
    } catch (err) {
      container.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      return false;
    }
  }

  async function refreshAdminDemo() {
    await loadAdminBookings();
    await loadWaitlist();
  }

  async function resetDemoData({ confirmFirst = true } = {}) {
    if (confirmFirst && !window.confirm("Demo zurücksetzen und Beispieldaten neu laden?")) return false;

    const user = sessionStorage.getItem(ADMIN_USER_STORAGE) || "";
    const key = sessionStorage.getItem(ADMIN_STORAGE) || "";
    localStorage.removeItem("bookings");
    const params = new URLSearchParams({ user, key });
    const { res, data } = await apiFetch(`/api/demo-reset?${params.toString()}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(data.error || "Demo-Reset fehlgeschlagen");
    await refreshAdminDemo();
    return true;
  }

  async function ensureDemoDataLoaded() {
    const hasDemoData = adminState.bookings.length || (adminState.waitlist.entries || []).length;
    if (hasDemoData) return;
    try {
      await resetDemoData({ confirmFirst: false });
      setAdminStatus("Demo-Daten automatisch geladen: Kalender und Warteliste sind bereit.", "ok");
    } catch {
      // If the API is unavailable, the existing fallback/error UI remains visible.
    }
  }

  async function handleWaitlistSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const btn = $("#waitlist-submit-btn");
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    const user = sessionStorage.getItem(ADMIN_USER_STORAGE) || "";
    const key = sessionStorage.getItem(ADMIN_STORAGE) || "";

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Wird hinzugefügt…";
    }

    try {
      const params = new URLSearchParams({ user, key });
      const { res, data } = await apiFetch(`/api/waitlist?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(data.error || "Wartelisteneintrag fehlgeschlagen");
      form.reset();
      form.querySelector('[name="durationMinutes"]').value = "60";
      form.querySelector('[name="earliestTime"]').value = "09:00";
      form.querySelector('[name="latestTime"]').value = "17:00";
      form.querySelector('[name="ranking"]').value = "0";
      await loadWaitlist();
    } catch (err) {
      showError(err.message || "Wartelisteneintrag fehlgeschlagen");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Zur Warteliste hinzufügen";
      }
    }
  }

  async function handleNotificationAction(e) {
    const takeBtn = e.target.closest(".take-notification-btn");
    const declineBtn = e.target.closest(".decline-notification-btn");
    const btn = takeBtn || declineBtn;
    if (!btn) return;

    const token = decodeURIComponent(btn.dataset.token || "");
    if (!token) return;
    const action = takeBtn ? "accept" : "decline";

    btn.disabled = true;
    btn.textContent = action === "accept" ? "Wird übernommen…" : "Wird abgelehnt…";

    try {
      const { res, data } = await apiFetch("/api/waitlist-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      if (!res.ok) throw new Error(data.error || "Demo-Aktion fehlgeschlagen");
      await refreshAdminDemo();
      setAdminStatus(
        action === "accept"
          ? "Termin übernommen: Der freie Slot ist wieder gebucht."
          : "Kunde hat abgelehnt. Der Status wurde in der Demo-Inbox aktualisiert.",
        "ok"
      );
    } catch (err) {
      showError(err.message || "Demo-Aktion fehlgeschlagen");
      btn.disabled = false;
      btn.textContent = action === "accept" ? "Termin übernehmen" : "Nein danke";
    }
  }

  async function handleDemoReset() {
    const btn = $("#demo-reset-btn");
    const heroBtn = $("#demo-reset-hero-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Wird zurückgesetzt…";
    }
    if (heroBtn) {
      heroBtn.disabled = true;
      heroBtn.textContent = "Wird geladen…";
    }

    try {
      const didReset = await resetDemoData({ confirmFirst: true });
      if (didReset) setAdminStatus("Demo zurückgesetzt: Beispieltermine und Warteliste sind bereit.", "ok");
    } catch (err) {
      showError(err.message || "Demo-Reset fehlgeschlagen");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Demo zurücksetzen";
      }
      if (heroBtn) {
        heroBtn.disabled = false;
        heroBtn.textContent = "Demo-Daten laden";
      }
    }
  }

  function deleteLocalBooking(id) {
    const bookings = getLocalBookings().filter((booking) => String(booking.id) !== String(id));
    localStorage.setItem("bookings", JSON.stringify(bookings));
  }

  async function handleDeleteBooking(e) {
    const btn = e.target.closest(".delete-booking-btn");
    if (!btn) return;

    const id = decodeURIComponent(btn.dataset.id || "");
    const source = btn.dataset.source || "server";
    if (!id) return;

    if (!window.confirm("Kundenabsage simulieren und Warteliste automatisch prüfen?")) return;

    btn.disabled = true;
    btn.textContent = "Absage läuft…";

    try {
      let waitlistMessage = "";
      if (source === "browser") {
        deleteLocalBooking(id);
      } else {
        const user = sessionStorage.getItem(ADMIN_USER_STORAGE) || "";
        const key = sessionStorage.getItem(ADMIN_STORAGE) || "";
        const params = new URLSearchParams({ id, user, key });
        const { res, data } = await apiFetch(`/api/bookings?${params.toString()}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(data.error || "Löschen fehlgeschlagen");
        const offerCount = data.waitlist?.offers?.length || 0;
        if (offerCount) {
          waitlistMessage = `${offerCount} passende Demo-Notification${offerCount === 1 ? "" : "s"} erzeugt.`;
        } else {
          waitlistMessage = "Absage verarbeitet. Kein passender Wartelistenkunde gefunden.";
        }
      }
      await refreshAdminDemo();
      if (waitlistMessage) setAdminStatus(waitlistMessage, "ok");
    } catch (err) {
      showError(err.message || "Löschen fehlgeschlagen");
      btn.disabled = false;
      btn.textContent = "Absage simulieren";
    }
  }

  function showAdminLogin() {
    const login = $("#login-card");
    const story = $("#demo-story-card");
    const list = $("#list-card");
    const waitlist = $("#waitlist-card");
    if (login) login.hidden = false;
    if (story) story.hidden = true;
    if (list) list.hidden = true;
    if (waitlist) waitlist.hidden = true;
  }

  function showAdminList() {
    const login = $("#login-card");
    const story = $("#demo-story-card");
    const list = $("#list-card");
    const waitlist = $("#waitlist-card");
    if (login) login.hidden = true;
    if (story) story.hidden = false;
    if (list) list.hidden = false;
    if (waitlist) waitlist.hidden = false;
    story?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleAdminLogin() {
    const user = $("#admin-user")?.value.trim();
    const key = $("#admin-key")?.value.trim();
    const btn = $("#admin-login-btn");
    if (!user) {
      setAdminStatus("Bitte gib den Benutzernamen ein.", "error");
      return;
    }
    if (!key) {
      setAdminStatus("Bitte gib das Passwort ein.", "error");
      return;
    }

    setAdminStatus("Wird geprüft…", "");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Wird geprüft…";
    }

    sessionStorage.setItem(ADMIN_USER_STORAGE, user);
    sessionStorage.setItem(ADMIN_STORAGE, key);
    showAdminList();

    const ok = await loadAdminBookings();
    await loadWaitlist();
    await ensureDemoDataLoaded();

    if (btn) {
      btn.disabled = false;
      btn.textContent = "Termine anzeigen";
    }

    if (ok) {
      setAdminStatus("Angemeldet.", "ok");
    }
  }

  let managerReady = false;
  function initManager() {
    if (managerReady) {
      if (sessionStorage.getItem(ADMIN_USER_STORAGE) && sessionStorage.getItem(ADMIN_STORAGE)) {
        showAdminList();
        refreshAdminDemo().then(ensureDemoDataLoaded);
      } else {
        showAdminLogin();
      }
      return;
    }
    managerReady = true;

    $("#login-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      handleAdminLogin();
    });

    $("#admin-login-btn")?.addEventListener("click", handleAdminLogin);

    $("#refresh-btn")?.addEventListener("click", async () => {
      await refreshAdminDemo();
    });
    $("#refresh-waitlist-btn")?.addEventListener("click", loadWaitlist);
    $("#demo-reset-btn")?.addEventListener("click", handleDemoReset);
    $("#demo-reset-hero-btn")?.addEventListener("click", handleDemoReset);
    $("#waitlist-form")?.addEventListener("submit", handleWaitlistSubmit);
    $("#bookings-container")?.addEventListener("click", handleDeleteBooking);
    $("#demo-dashboard")?.addEventListener("click", handleDeleteBooking);
    $("#waitlist-container")?.addEventListener("click", handleNotificationAction);
    $("#logout-btn")?.addEventListener("click", () => {
      sessionStorage.removeItem(ADMIN_USER_STORAGE);
      sessionStorage.removeItem(ADMIN_STORAGE);
      $("#admin-user").value = "";
      $("#admin-key").value = "";
      setAdminStatus("", "");
      showAdminLogin();
    });

    if (sessionStorage.getItem(ADMIN_USER_STORAGE) && sessionStorage.getItem(ADMIN_STORAGE)) {
      showAdminList();
      refreshAdminDemo().then(ensureDemoDataLoaded);
    } else {
      showAdminLogin();
    }
  }

  function getWaitlistToken() {
    return new URLSearchParams(window.location.search).get("token") || "";
  }

  function renderOfferLoading(message) {
    const container = $("#waitlist-offer-container");
    if (container) container.innerHTML = `<p class="loading">${escapeHtml(message)}</p>`;
  }

  function renderOfferError(message) {
    const container = $("#waitlist-offer-container");
    if (!container) return;
    container.innerHTML = `
      <h2>Termin nicht verfügbar</h2>
      <p class="claim-note">${escapeHtml(message)}</p>
      <p class="claim-note"><a href="./index.html" class="muted-link">Zur regulären Buchung</a></p>
    `;
  }

  function renderOffer(offer) {
    const container = $("#waitlist-offer-container");
    if (!container) return;
    if (offer.status !== "pending") {
      renderOfferError("Dieses Wartelisten-Angebot wurde bereits verwendet oder ist abgelaufen.");
      return;
    }

    container.innerHTML = `
      <h2>Hallo ${escapeHtml(offer.customerName || "")}, dein Wunschslot ist frei.</h2>
      <div class="claim-summary">
        <p><strong>${escapeHtml(offer.service || "Salontermin")}</strong></p>
        <p>${escapeHtml(formatDateTime(offer.slot?.start))}</p>
        <p>${escapeHtml(offer.durationMinutes || "")} Minuten</p>
      </div>
      <p class="claim-note">Diese Demo-Notification ist bis ${escapeHtml(formatDateTime(offer.expiresAt))} gültig. Sobald jemand bestätigt, ist der Slot vergeben.</p>
      <div class="nav-row">
        <button type="button" class="btn ghost" id="decline-offer-btn">Nein danke</button>
        <button type="button" class="btn primary" id="claim-offer-btn">Termin übernehmen</button>
      </div>
    `;

    $("#claim-offer-btn")?.addEventListener("click", claimWaitlistOffer);
    $("#decline-offer-btn")?.addEventListener("click", declineWaitlistOffer);
  }

  async function loadWaitlistOffer() {
    const token = getWaitlistToken();
    if (!token) {
      renderOfferError("Die Demo-Notification enthält kein gültiges Angebot.");
      return;
    }

    try {
      const params = new URLSearchParams({ token });
      const { res, data } = await apiFetch(`/api/waitlist-offer?${params.toString()}`);
      if (!res.ok) throw new Error(data.error || "Angebot konnte nicht geladen werden");
      renderOffer(data.offer);
    } catch (err) {
      renderOfferError(err.message || "Angebot konnte nicht geladen werden");
    }
  }

  async function claimWaitlistOffer() {
    const token = getWaitlistToken();
    const btn = $("#claim-offer-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Wird gebucht…";
    }

    try {
      const { res, data } = await apiFetch("/api/waitlist-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "accept" }),
      });
      if (!res.ok) throw new Error(data.error || "Buchung fehlgeschlagen");
      const container = $("#waitlist-offer-container");
      if (container) {
        container.innerHTML = `
          <div class="success-icon">✓</div>
          <h2>Dein Termin ist gebucht!</h2>
          <p class="claim-note">${escapeHtml(formatDateTime(data.booking?.start))} ist jetzt verbindlich für dich reserviert.</p>
        `;
      }
    } catch (err) {
      renderOfferError(err.message || "Buchung fehlgeschlagen");
    }
  }

  async function declineWaitlistOffer() {
    const token = getWaitlistToken();
    const btn = $("#decline-offer-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Wird abgelehnt…";
    }

    try {
      const { res, data } = await apiFetch("/api/waitlist-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "decline" }),
      });
      if (!res.ok) throw new Error(data.error || "Ablehnen fehlgeschlagen");
      const container = $("#waitlist-offer-container");
      if (container) {
        container.innerHTML = `
          <h2>Alles klar, danke!</h2>
          <p class="claim-note">Der Salon gibt den freien Slot in der Demo an den nächsten passenden Wartelistenkunden weiter.</p>
        `;
      }
    } catch (err) {
      renderOfferError(err.message || "Ablehnen fehlgeschlagen");
    }
  }

  function init() {
    const hasBooking = !!$("#booking-card");
    const hasManager = !!$("#manager-app");
    const hasWaitlistClaim = !!$("#waitlist-claim-app");

    if (hasBooking) {
      initDateInput();
      setupNavigation();
      setupServices();
      setupStaff();

      const form = $("#details-form");
      if (form) form.addEventListener("submit", submitBooking);

      const again = $("#book-another");
      if (again) again.addEventListener("click", resetBooking);
    }

    if (hasManager) initManager();
    if (hasWaitlistClaim) loadWaitlistOffer();

    if (!hasBooking && !hasManager && !hasWaitlistClaim) return;

    window.__bookingAppReady = true;
    const warn = $("#js-warning");
    if (warn) warn.hidden = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
