(function () {
  "use strict";

  const DEFAULT_SERVICE = "Haare schneiden";
  const SLOT_MINUTES = 60;
  const BUSINESS_START = 9;
  const BUSINESS_END = 17;

  const state = {
    step: 1,
    service: DEFAULT_SERVICE,
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
        ? `${state.service} am ${formatDateLabel(state.date)} um ${state.slot.label}. Auf diesem Gerät gespeichert (Demo).`
        : `${state.service} am ${formatDateLabel(state.date)} um ${state.slot.label}. Bestätigung an ${payload.email} gesendet.`;

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

  const ADMIN_USER_STORAGE = "booking_admin_user";
  const ADMIN_STORAGE = "booking_admin_key";

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
        <td>${escapeHtml(b.name || "—")}</td>
        <td>${escapeHtml(b.email || "—")}</td>
        <td>${escapeHtml(b.notes || "—")}</td>
        <td><button type="button" class="btn ghost small delete-booking-btn" data-id="${encodeURIComponent(String(b.id || ""))}" data-source="${escapeHtml(b.source || "server")}" ${b.id ? "" : "disabled"}>Löschen</button></td>
      </tr>`
      )
      .join("");

    container.innerHTML = `<table class="bookings-table">
        <thead><tr><th>Datum</th><th>Uhrzeit</th><th>Service</th><th>Kunde</th><th>E-Mail</th><th>Notizen</th><th>Aktion</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
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
      renderAdminBookings(bookings);
      setAdminStatus("", "");
      return true;
    } catch (err) {
      const local = getLocalBookings();
      if (local.length) {
        renderAdminBookings(local);
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

    if (!window.confirm("Diesen Termin löschen?")) return;

    btn.disabled = true;
    btn.textContent = "Wird gelöscht…";

    try {
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
      }
      await loadAdminBookings();
    } catch (err) {
      showError(err.message || "Löschen fehlgeschlagen");
      btn.disabled = false;
      btn.textContent = "Löschen";
    }
  }

  function showAdminLogin() {
    const login = $("#login-card");
    const list = $("#list-card");
    if (login) login.hidden = false;
    if (list) list.hidden = true;
  }

  function showAdminList() {
    const login = $("#login-card");
    const list = $("#list-card");
    if (login) login.hidden = true;
    if (list) list.hidden = false;
    list?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        loadAdminBookings();
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

    $("#refresh-btn")?.addEventListener("click", loadAdminBookings);
    $("#bookings-container")?.addEventListener("click", handleDeleteBooking);
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
      loadAdminBookings();
    } else {
      showAdminLogin();
    }
  }

  function init() {
    const hasBooking = !!$("#booking-card");
    const hasManager = !!$("#manager-app");

    if (hasBooking) {
      initDateInput();
      setupNavigation();
      setupServices();

      const form = $("#details-form");
      if (form) form.addEventListener("submit", submitBooking);

      const again = $("#book-another");
      if (again) again.addEventListener("click", resetBooking);
    }

    if (hasManager) initManager();

    if (!hasBooking && !hasManager) return;

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
