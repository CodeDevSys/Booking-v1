const fs = require("fs");
const path = require("path");

const CREDENTIALS_PATH = path.join(__dirname, "..", "credentials.json");
const DEFAULT_SERVICE = "Haare schneiden";
const SLOT_MINUTES = Number(process.env.SLOT_MINUTES) || 60;
const BUSINESS_START = Number(process.env.BUSINESS_START) || 9;
const BUSINESS_END = Number(process.env.BUSINESS_END) || 17;
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "Europe/Berlin";
const BOOKINGS_DIR = process.env.BOOKINGS_DATA_DIR || path.join(__dirname, "..", "data");
const BOOKINGS_FILE = path.join(BOOKINGS_DIR, "bookings.json");

const bookings = loadStoredBookings();

let calendarClient = null;
let calendarId = null;

function loadStoredBookings() {
  try {
    if (!fs.existsSync(BOOKINGS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn("Could not load stored bookings, using memory only:", err.message);
    return [];
  }
}

function saveStoredBookings() {
  try {
    fs.mkdirSync(BOOKINGS_DIR, { recursive: true });
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
  } catch (err) {
    console.warn("Could not save bookings to disk, keeping memory only:", err.message);
  }
}

function sortBookings(list) {
  return [...list].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

function rangesOverlap(startA, endA, startB, endB) {
  return new Date(startA).getTime() < new Date(endB).getTime() &&
    new Date(endA).getTime() > new Date(startB).getTime();
}

function toBusinessDateKey(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function loadGoogleCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } catch {
      console.warn("GOOGLE_CREDENTIALS_JSON is not valid JSON");
      return null;
    }
  }
  if (fs.existsSync(CREDENTIALS_PATH)) {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  }
  return null;
}

async function initGoogleCalendar() {
  const id = process.env.GOOGLE_CALENDAR_ID;
  const credentials = loadGoogleCredentials();
  if (!id || !credentials) return false;

  try {
    let google;
    try {
      ({ google } = require("googleapis"));
    } catch {
      console.warn("googleapis not installed — use in-memory bookings or run: npm install googleapis");
      return false;
    }
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    calendarClient = google.calendar({ version: "v3", auth });
    calendarId = id;
    return true;
  } catch (err) {
    console.warn("Google Calendar init failed, using in-memory store:", err.message);
    return false;
  }
}

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function parseTimezoneOffset(value) {
  const offset = Number(value);
  return Number.isFinite(offset) ? offset : null;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayKeyForTimezone(timezoneOffset) {
  if (timezoneOffset === null) return toDateKey(new Date());
  const localNow = new Date(Date.now() - timezoneOffset * 60000);
  return `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth() + 1).padStart(2, "0")}-${String(localNow.getUTCDate()).padStart(2, "0")}`;
}

function createSlotDate(dateStr, minutes, timezoneOffset) {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (timezoneOffset === null) {
    const date = new Date(year, month - 1, day);
    date.setHours(0, minutes, 0, 0);
    return date;
  }
  return new Date(Date.UTC(year, month - 1, day, 0, minutes) + timezoneOffset * 60000);
}

function formatSlotTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function generateDaySlots(dateStr, timezoneOffset) {
  const slots = [];
  const startMinutes = BUSINESS_START * 60;
  const endMinutes = BUSINESS_END * 60;

  for (let minutes = startMinutes; minutes < endMinutes; minutes += SLOT_MINUTES) {
    const t = createSlotDate(dateStr, minutes, timezoneOffset);
    slots.push({
      start: t.toISOString(),
      end: new Date(t.getTime() + SLOT_MINUTES * 60000).toISOString(),
      label: formatSlotTime(minutes),
    });
  }
  return slots;
}

function isSlotBooked(slotStart, bookedRanges) {
  const start = new Date(slotStart).getTime();
  const end = start + SLOT_MINUTES * 60000;
  return bookedRanges.some((b) => {
    return rangesOverlap(start, end, b.start, b.end);
  });
}

async function getBusyRanges(dateStr, timezoneOffset) {
  const dayStart = createSlotDate(dateStr, 0, timezoneOffset);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60000);

  if (calendarClient && calendarId) {
    const res = await calendarClient.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = res.data.calendars?.[calendarId]?.busy || [];
    return busy.map((b) => ({ start: b.start, end: b.end }));
  }

  return bookings
    .filter((b) => b.date === dateStr && b.status !== "cancelled")
    .map((b) => ({ start: b.start, end: b.end }));
}

async function getAvailableSlots(dateStr, options = {}) {
  const timezoneOffset = parseTimezoneOffset(options.timezoneOffset);
  if (dateStr < todayKeyForTimezone(timezoneOffset)) return [];

  const requested = parseDate(dateStr);
  const isWeekend = requested.getDay() === 0 || requested.getDay() === 6;
  if (isWeekend) return [];

  const busy = await getBusyRanges(dateStr, timezoneOffset);
  const allSlots = generateDaySlots(dateStr, timezoneOffset);
  const now = Date.now();

  return allSlots.filter((slot) => {
    if (new Date(slot.start).getTime() <= now) return false;
    return !isSlotBooked(slot.start, busy);
  });
}

async function isTimeRangeAvailable({ date, start, end }) {
  const busy = await getBusyRanges(date, null);
  return !busy.some((range) => rangesOverlap(start, end, range.start, range.end));
}

async function createBooking({ date, start, name, email, phone, notes, service, durationMinutes, staff, waitlistEntryId }) {
  const minutes = Number(durationMinutes) || SLOT_MINUTES;
  const slotEnd = new Date(new Date(start).getTime() + minutes * 60000);
  const booking = {
    id: crypto.randomUUID(),
    date,
    start,
    end: slotEnd.toISOString(),
    name,
    email,
    phone: phone || "",
    notes: notes || "",
    service: service || DEFAULT_SERVICE,
    durationMinutes: minutes,
    staff: staff || "",
    waitlistEntryId: waitlistEntryId || "",
    createdAt: new Date().toISOString(),
  };

  if (calendarClient && calendarId) {
    await calendarClient.events.insert({
      calendarId,
      requestBody: {
        summary: `${booking.service} — ${name}`,
        description: [
          `E-Mail: ${email}`,
          phone ? `Telefon: ${phone}` : "",
          staff ? `Mitarbeiter: ${staff}` : "",
          waitlistEntryId ? `Warteliste: ${waitlistEntryId}` : "",
          notes ? `Notizen: ${notes}` : "",
        ].filter(Boolean).join("\n"),
        start: { dateTime: start },
        end: { dateTime: booking.end },
      },
    });
  } else {
    const cancelledIndex = bookings.findIndex((b) =>
      b.status === "cancelled" &&
      b.date === date &&
      rangesOverlap(start, booking.end, b.start, b.end)
    );
    if (cancelledIndex !== -1 && waitlistEntryId) {
      bookings[cancelledIndex] = {
        ...bookings[cancelledIndex],
        ...booking,
        id: bookings[cancelledIndex].id,
        status: "confirmed",
      };
      saveStoredBookings();
      return bookings[cancelledIndex];
    }

    const conflict = bookings.some((b) =>
      b.status !== "cancelled" &&
      b.date === date &&
      rangesOverlap(start, booking.end, b.start, b.end)
    );
    if (conflict) {
      const err = new Error("Dieser Termin ist nicht mehr verfügbar");
      err.status = 409;
      throw err;
    }
    bookings.push(booking);
    saveStoredBookings();
  }

  return booking;
}

async function deleteBooking(id) {
  if (!id) {
    const err = new Error("Buchungs-ID erforderlich");
    err.status = 400;
    throw err;
  }

  if (calendarClient && calendarId) {
    await calendarClient.events.delete({
      calendarId,
      eventId: id,
    });
    return { id };
  }

  const index = bookings.findIndex((booking) => booking.id === id);
  if (index === -1) {
    const err = new Error("Buchung nicht gefunden");
    err.status = 404;
    throw err;
  }

  const [deleted] = bookings.splice(index, 1);
  saveStoredBookings();
  return deleted;
}

async function listBookings() {
  if (calendarClient && calendarId) {
    const now = new Date().toISOString();
    const res = await calendarClient.events.list({
      calendarId,
      timeMin: now,
      maxResults: 100,
      singleEvents: true,
      orderBy: "startTime",
    });
    return (res.data.items || []).map((e) => {
      const desc = e.description || "";
      const emailMatch = desc.match(/(?:Email|E-Mail):\s*(\S+)/);
      const phoneMatch = desc.match(/(?:Telefon|Phone):\s*(.+)/);
      const staffMatch = desc.match(/(?:Mitarbeiter|Staff):\s*(.+)/);
      const notesMatch = desc.match(/(?:Notes|Notizen):\s*(.+)/);
      const summary = e.summary || "";
      const parts = summary.split("—");
      const start = e.start?.dateTime || e.start?.date;
      const end = e.end?.dateTime || e.end?.date;
      return {
        id: e.id,
        service: parts[0]?.trim() || summary,
        name: parts[1]?.trim() || "",
        email: emailMatch ? emailMatch[1] : "",
        phone: phoneMatch ? phoneMatch[1].trim() : "",
        staff: staffMatch ? staffMatch[1].trim() : "",
        notes: notesMatch ? notesMatch[1].trim() : "",
        date: start ? toBusinessDateKey(start) : "",
        start,
        end,
        source: "google",
      };
    });
  }
  return sortBookings(bookings.map((b) => ({ ...b, source: "server" })));
}

function resetBookings(nextBookings = []) {
  bookings.splice(0, bookings.length, ...nextBookings);
  saveStoredBookings();
  return sortBookings(bookings.map((b) => ({ ...b, source: "server" })));
}

module.exports = {
  initGoogleCalendar,
  getAvailableSlots,
  isTimeRangeAvailable,
  createBooking,
  deleteBooking,
  getBookings: () => sortBookings(bookings),
  listBookings,
  resetBookings,
};
