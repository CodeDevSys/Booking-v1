const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const calendar = require("./calendar");
const notificationService = require("./notification-service");

const DATA_DIR = process.env.BOOKINGS_DATA_DIR || path.join(__dirname, "..", "data");
const WAITLIST_FILE = path.join(DATA_DIR, "waitlist.json");
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "Europe/Berlin";
const DEFAULT_SERVICE = "Haare schneiden";
const DEFAULT_DURATION_MINUTES = Number(process.env.SLOT_MINUTES) || 60;
const DEFAULT_BATCH_SIZE = 4;
const FIRST_COME = "first-come";
const CASCADE = "cascade";

const SERVICE_DURATIONS = {
  "Haare schneiden": 60,
  Haarstyling: 60,
  "Haare färben": 120,
};

const store = loadStore();

function loadStore() {
  try {
    if (!fs.existsSync(WAITLIST_FILE)) {
      return { entries: [], campaigns: [], offers: [], messages: [] };
    }
    const data = JSON.parse(fs.readFileSync(WAITLIST_FILE, "utf8"));
    return {
      entries: Array.isArray(data.entries) ? data.entries : [],
      campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      offers: Array.isArray(data.offers) ? data.offers : [],
      messages: Array.isArray(data.messages) ? data.messages : [],
    };
  } catch (err) {
    console.warn("Could not load waitlist data, using memory only:", err.message);
    return { entries: [], campaigns: [], offers: [], messages: [] };
  }
}

function saveStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WAITLIST_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.warn("Could not save waitlist data to disk, keeping memory only:", err.message);
  }
}

function normalizeStrategy(value = process.env.WAITLIST_STRATEGY) {
  return String(value || FIRST_COME).toLowerCase() === CASCADE ? CASCADE : FIRST_COME;
}

function batchSize() {
  const configured = Number(process.env.WAITLIST_BATCH_SIZE) || DEFAULT_BATCH_SIZE;
  return Math.max(3, Math.min(5, configured));
}

function cascadeMinutes() {
  return Math.max(1, Number(process.env.WAITLIST_CASCADE_MINUTES) || 15);
}

function serviceDuration(service, fallback) {
  return Number(SERVICE_DURATIONS[service]) || Number(fallback) || DEFAULT_DURATION_MINUTES;
}

function parseClock(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesInBusinessTimezone(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function formatBusinessDate(value) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatBusinessTime(value) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function defaultBaseUrl() {
  return process.env.WAITLIST_PUBLIC_BASE_URL || process.env.APP_URL || process.env.PUBLIC_URL || "";
}

function publicOfferUrl(token, baseUrl = defaultBaseUrl()) {
  const pathAndQuery = `/waitlist.html?token=${encodeURIComponent(token)}`;
  if (!baseUrl) return pathAndQuery;
  return `${String(baseUrl).replace(/\/$/, "")}${pathAndQuery}`;
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function sanitizePhone(value) {
  return sanitizeText(value).replace(/[^\d+()\-.\s]/g, "");
}

function normalizeEntryPayload(payload = {}) {
  const service = sanitizeText(payload.service) || DEFAULT_SERVICE;
  const durationMinutes = Number(payload.durationMinutes) || serviceDuration(service);
  const preferredDate = sanitizeText(payload.preferredDate);
  const earliestTime = sanitizeText(payload.earliestTime);
  const latestTime = sanitizeText(payload.latestTime);

  return {
    name: sanitizeText(payload.name),
    email: sanitizeText(payload.email).toLowerCase(),
    phone: sanitizePhone(payload.phone),
    service,
    durationMinutes,
    staffPreference: sanitizeText(payload.staffPreference),
    preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ? preferredDate : "",
    earliestTime: parseClock(earliestTime) === null ? "" : earliestTime,
    latestTime: parseClock(latestTime) === null ? "" : latestTime,
    notes: sanitizeText(payload.notes),
    ranking: Number(payload.ranking) || 0,
  };
}

function validateEntry(entry) {
  if (!entry.name) return "Name ist erforderlich";
  if (!entry.phone) return "Telefonnummer ist erforderlich";
  if (entry.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)) {
    return "Ungültige E-Mail-Adresse";
  }
  if (entry.durationMinutes < 15 || entry.durationMinutes > 360) {
    return "Dauer muss zwischen 15 und 360 Minuten liegen";
  }
  const earliest = parseClock(entry.earliestTime);
  const latest = parseClock(entry.latestTime);
  if (earliest !== null && latest !== null && earliest >= latest) {
    return "Die späteste Zeit muss nach der frühesten Zeit liegen";
  }
  return "";
}

function createWaitlistEntry(payload) {
  const normalized = normalizeEntryPayload(payload);
  const error = validateEntry(normalized);
  if (error) {
    const err = new Error(error);
    err.status = 400;
    throw err;
  }

  const entry = {
    id: randomUUID(),
    ...normalized,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.entries.push(entry);
  saveStore();
  return entry;
}

async function listWaitlist(options = {}) {
  await processDueCascades(options);
  return {
    entries: [...store.entries].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    offers: [...store.offers].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    campaigns: [...store.campaigns].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    messages: [...store.messages].slice(-50).reverse(),
    notifications: [...store.messages].slice(-50).reverse(),
  };
}

function activeEntries() {
  return store.entries.filter((entry) => entry.status === "active");
}

function slotDurationMinutes(slot) {
  return Math.round((new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60000);
}

function staffMatches(entry, slot) {
  const preference = sanitizeText(entry.staffPreference).toLowerCase();
  if (!preference || ["egal", "beliebig", "any", "keine präferenz", "keine praferenz"].includes(preference)) {
    return true;
  }
  const slotStaff = sanitizeText(slot.staff).toLowerCase();
  return !slotStaff || slotStaff === preference;
}

function availabilityMatches(entry, slot) {
  if (entry.preferredDate && entry.preferredDate !== slot.date) return false;

  const slotStart = minutesInBusinessTimezone(slot.start);
  const slotEnd = minutesInBusinessTimezone(slot.end);
  const earliest = parseClock(entry.earliestTime);
  const latest = parseClock(entry.latestTime);
  if (earliest !== null && slotStart < earliest) return false;
  if (latest !== null && slotEnd > latest) return false;
  return true;
}

function entryScore(entry, slot) {
  const durationGap = Math.max(0, slotDurationMinutes(slot) - entry.durationMinutes);
  let score = Number(entry.ranking) || 0;
  if (durationGap === 0) score += 3;
  if (entry.staffPreference) score += 1;
  if (entry.preferredDate === slot.date) score += 1;
  return score;
}

function findMatches(slot) {
  const freeMinutes = slotDurationMinutes(slot);
  return activeEntries()
    .filter((entry) => entry.durationMinutes <= freeMinutes)
    .filter((entry) => staffMatches(entry, slot))
    .filter((entry) => availabilityMatches(entry, slot))
    .map((entry) => ({ entry, score: entryScore(entry, slot) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.entry.createdAt).getTime() - new Date(b.entry.createdAt).getTime();
    });
}

function slotFromBooking(booking) {
  if (!booking?.start || !booking?.end) return null;
  return {
    date: booking.date || "",
    start: booking.start,
    end: booking.end,
    service: booking.service || DEFAULT_SERVICE,
    staff: booking.staff || "",
  };
}

function slotKey(slot) {
  return `${slot.date}|${slot.start}|${slot.end}|${slot.staff || ""}`;
}

function claimDeadline(strategy) {
  if (strategy === CASCADE) {
    return new Date(Date.now() + cascadeMinutes() * 60000).toISOString();
  }
  return new Date(Date.now() + 24 * 60 * 60000).toISOString();
}

function notificationBody(entry, offer, url) {
  return [
    `Hallo ${entry.name} 👋`,
    "",
    "ein Termin ist kurzfristig frei geworden:",
    `${offer.slot.service} am ${formatBusinessDate(offer.slot.start)} um ${formatBusinessTime(offer.slot.start)}.`,
    "",
    "Möchtest du den Termin übernehmen?",
    url ? `Demo-Link: ${url}` : "",
  ].filter((line) => line !== "").join("\n");
}

async function createMockNotification(entry, offer, options = {}) {
  const url = publicOfferUrl(offer.token, options.baseUrl);
  const message = notificationBody(entry, offer, url);
  const record = notificationService.createWhatsAppDemoNotification({ entry, offer, message });

  console.log(`[demo notification] ${entry.name} (${entry.phone}): ${message.replace(/\n/g, " ")}`);
  store.messages.push(record);
  saveStore();
  return record;
}

function updateNotificationsForOffer(offerId, status) {
  for (const notification of store.messages) {
    if (notification.offerId === offerId) {
      notification.status = status;
      notification.updatedAt = new Date().toISOString();
    }
  }
}

async function dispatchOffer(campaign, entry, options = {}) {
  const token = randomUUID();
  const offer = {
    id: randomUUID(),
    campaignId: campaign.id,
    entryId: entry.id,
    token,
    strategy: campaign.strategy,
    status: "pending",
    slot: campaign.slot,
    expiresAt: claimDeadline(campaign.strategy),
    createdAt: new Date().toISOString(),
    claimedAt: "",
    bookingId: "",
  };
  store.offers.push(offer);
  campaign.nextIndex += 1;
  campaign.updatedAt = new Date().toISOString();
  saveStore();
  await createMockNotification(entry, offer, options);
  return offer;
}

async function createOffersForCancellation(booking, options = {}) {
  await processDueCascades(options);
  const slot = slotFromBooking(booking);
  if (!slot) return { matches: [], offers: [], campaign: null };

  const matches = findMatches(slot);
  if (!matches.length) return { matches: [], offers: [], campaign: null };

  const strategy = normalizeStrategy(options.strategy);
  const candidates = strategy === FIRST_COME ? matches.slice(0, batchSize()) : matches;
  const campaign = {
    id: randomUUID(),
    slotKey: slotKey(slot),
    slot,
    strategy,
    status: "open",
    candidateEntryIds: candidates.map((match) => match.entry.id),
    nextIndex: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.campaigns.push(campaign);
  saveStore();

  const entriesToNotify = strategy === FIRST_COME ? candidates : candidates.slice(0, 1);
  const offers = [];
  for (const match of entriesToNotify) {
    offers.push(await dispatchOffer(campaign, match.entry, options));
  }

  return {
    matches: matches.map(({ entry, score }) => ({ entryId: entry.id, name: entry.name, score })),
    offers,
    campaign,
  };
}

function markExpiredOffers(now = Date.now()) {
  let changed = false;
  for (const offer of store.offers) {
    if (offer.status === "pending" && new Date(offer.expiresAt).getTime() <= now) {
      offer.status = "expired";
      offer.updatedAt = new Date().toISOString();
      updateNotificationsForOffer(offer.id, "expired");
      changed = true;
    }
  }
  return changed;
}

function runDueCascades() {
  const changed = markExpiredOffers();
  for (const campaign of store.campaigns) {
    if (campaign.strategy !== CASCADE || campaign.status !== "open") continue;
    const pending = store.offers.some((offer) => offer.campaignId === campaign.id && offer.status === "pending");
    if (pending) continue;
    if (campaign.nextIndex >= campaign.candidateEntryIds.length) {
      campaign.status = "expired";
      campaign.updatedAt = new Date().toISOString();
    }
  }
  if (changed) saveStore();
}

async function processDueCascades(options = {}) {
  runDueCascades();
  for (const campaign of store.campaigns) {
    if (campaign.strategy !== CASCADE || campaign.status !== "open") continue;
    const pending = store.offers.some((offer) => offer.campaignId === campaign.id && offer.status === "pending");
    if (pending) continue;
    if (campaign.nextIndex >= campaign.candidateEntryIds.length) continue;
    await advanceCascade(campaign, options);
  }
}

async function advanceCascade(campaign, options = {}) {
  if (campaign.strategy !== CASCADE || campaign.status !== "open") return null;
  runDueCascades();
  const pending = store.offers.some((offer) => offer.campaignId === campaign.id && offer.status === "pending");
  if (pending || campaign.status !== "open") return null;
  const entryId = campaign.candidateEntryIds[campaign.nextIndex];
  const entry = store.entries.find((item) => item.id === entryId && item.status === "active");
  if (!entry) {
    campaign.nextIndex += 1;
    saveStore();
    return advanceCascade(campaign, options);
  }
  return dispatchOffer(campaign, entry, options);
}

function publicOffer(offer) {
  const entry = store.entries.find((item) => item.id === offer.entryId);
  return {
    id: offer.id,
    status: offer.status,
    slot: offer.slot,
    expiresAt: offer.expiresAt,
    customerName: entry?.name || "",
    service: entry?.service || offer.slot.service,
    durationMinutes: entry?.durationMinutes || slotDurationMinutes(offer.slot),
  };
}

async function getOfferByToken(token, options = {}) {
  await processDueCascades(options);
  const offer = store.offers.find((item) => item.token === token);
  if (!offer) {
    const err = new Error("Angebot nicht gefunden");
    err.status = 404;
    throw err;
  }
  return publicOffer(offer);
}

async function claimOffer(token) {
  await processDueCascades();
  const offer = store.offers.find((item) => item.token === token);
  if (!offer) {
    const err = new Error("Angebot nicht gefunden");
    err.status = 404;
    throw err;
  }
  if (offer.status !== "pending") {
    const err = new Error("Dieses Angebot ist nicht mehr verfügbar");
    err.status = 409;
    throw err;
  }
  if (new Date(offer.expiresAt).getTime() <= Date.now()) {
    offer.status = "expired";
    offer.updatedAt = new Date().toISOString();
    saveStore();
    const err = new Error("Dieses Angebot ist abgelaufen");
    err.status = 409;
    throw err;
  }

  const entry = store.entries.find((item) => item.id === offer.entryId);
  if (!entry || entry.status !== "active") {
    const err = new Error("Dieser Wartelisteneintrag ist nicht mehr aktiv");
    err.status = 409;
    throw err;
  }

  const end = new Date(new Date(offer.slot.start).getTime() + entry.durationMinutes * 60000).toISOString();
  const available = await calendar.isTimeRangeAvailable({ date: offer.slot.date, start: offer.slot.start, end });
  if (!available) {
    offer.status = "unavailable";
    offer.updatedAt = new Date().toISOString();
    updateNotificationsForOffer(offer.id, "unavailable");
    saveStore();
    const err = new Error("Der Termin wurde bereits vergeben");
    err.status = 409;
    throw err;
  }

  const booking = await calendar.createBooking({
    date: offer.slot.date,
    start: offer.slot.start,
    name: entry.name,
    email: entry.email || `${entry.phone.replace(/\D/g, "") || "waitlist"}@waitlist.local`,
    phone: entry.phone,
    notes: entry.notes,
    service: entry.service || offer.slot.service,
    durationMinutes: entry.durationMinutes,
    staff: offer.slot.staff || entry.staffPreference,
    waitlistEntryId: entry.id,
  });

  offer.status = "booked";
  offer.claimedAt = new Date().toISOString();
  offer.bookingId = booking.id;
  updateNotificationsForOffer(offer.id, "accepted");
  entry.status = "booked";
  entry.updatedAt = new Date().toISOString();

  const campaign = store.campaigns.find((item) => item.id === offer.campaignId);
  if (campaign) {
    campaign.status = "booked";
    campaign.updatedAt = new Date().toISOString();
  }
  for (const other of store.offers) {
    if (other.campaignId === offer.campaignId && other.id !== offer.id && other.status === "pending") {
      other.status = "superseded";
      other.updatedAt = new Date().toISOString();
      updateNotificationsForOffer(other.id, "superseded");
    }
  }
  saveStore();
  return { booking, offer: publicOffer(offer) };
}

async function declineOffer(token, options = {}) {
  await processDueCascades(options);
  const offer = store.offers.find((item) => item.token === token);
  if (!offer) {
    const err = new Error("Angebot nicht gefunden");
    err.status = 404;
    throw err;
  }
  if (offer.status !== "pending") {
    const err = new Error("Dieses Angebot ist nicht mehr verfügbar");
    err.status = 409;
    throw err;
  }

  offer.status = "declined";
  offer.updatedAt = new Date().toISOString();
  updateNotificationsForOffer(offer.id, "declined");
  saveStore();

  const campaign = store.campaigns.find((item) => item.id === offer.campaignId);
  if (campaign?.strategy === CASCADE) {
    await advanceCascade(campaign, options);
  }

  return { offer: publicOffer(offer) };
}

function nextBusinessDateKey(daysAhead = 1) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysAhead);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function demoIso(dateKey, utcHour) {
  return new Date(`${dateKey}T${String(utcHour).padStart(2, "0")}:00:00.000Z`).toISOString();
}

function demoBooking({ id, date, utcHour, name, email, service, notes }) {
  const start = demoIso(date, utcHour);
  return {
    id,
    date,
    start,
    end: new Date(new Date(start).getTime() + DEFAULT_DURATION_MINUTES * 60000).toISOString(),
    name,
    email,
    phone: "",
    notes: notes || "",
    service: service || DEFAULT_SERVICE,
    durationMinutes: DEFAULT_DURATION_MINUTES,
    staff: "",
    waitlistEntryId: "",
    createdAt: new Date().toISOString(),
  };
}

function demoEntry({ id, name, phone, email, service, date, earliestTime, latestTime, ranking, notes }) {
  return {
    id,
    name,
    phone,
    email,
    service: service || DEFAULT_SERVICE,
    durationMinutes: serviceDuration(service || DEFAULT_SERVICE),
    staffPreference: "",
    preferredDate: date,
    earliestTime,
    latestTime,
    notes: notes || "",
    ranking: ranking || 0,
    status: "active",
    createdAt: new Date(Date.now() - (ranking || 0) * 60000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function resetDemoData() {
  const date = nextBusinessDateKey(1);
  const laterDate = nextBusinessDateKey(2);
  const bookings = calendar.resetBookings([
    demoBooking({
      id: "demo-booking-cancel",
      date,
      utcHour: 13,
      name: "Mia Schneider",
      email: "mia@example.com",
      service: "Haare schneiden",
      notes: "Demo: diesen Termin als Kundenabsage simulieren.",
    }),
    demoBooking({
      id: "demo-booking-keep",
      date,
      utcHour: 15,
      name: "Laura Becker",
      email: "laura@example.com",
      service: "Haarstyling",
      notes: "Bleibt im Kalender und zeigt belegte Slots.",
    }),
    demoBooking({
      id: "demo-booking-later",
      date: laterDate,
      utcHour: 12,
      name: "Sofia Wagner",
      email: "sofia@example.com",
      service: "Haare färben",
      notes: "Zweiter Präsentationstermin.",
    }),
  ]);

  store.entries.splice(0, store.entries.length,
    demoEntry({
      id: "demo-entry-anna",
      name: "Anna Müller",
      phone: "+49 170 1111111",
      email: "anna@example.com",
      service: "Haare schneiden",
      date,
      earliestTime: "14:00",
      latestTime: "16:30",
      ranking: 10,
      notes: "Möchte gerne früher kommen, wenn kurzfristig etwas frei wird.",
    }),
    demoEntry({
      id: "demo-entry-ben",
      name: "Ben Fischer",
      phone: "+49 170 2222222",
      email: "ben@example.com",
      service: "Haare schneiden",
      date,
      earliestTime: "13:00",
      latestTime: "17:00",
      ranking: 3,
      notes: "Flexibel am Nachmittag.",
    }),
    demoEntry({
      id: "demo-entry-clara",
      name: "Clara Neumann",
      phone: "+49 170 3333333",
      email: "clara@example.com",
      service: "Haarstyling",
      date: laterDate,
      earliestTime: "10:00",
      latestTime: "15:00",
      ranking: 1,
      notes: "Passt bewusst nicht zum Haarschnitt-Slot.",
    })
  );
  store.campaigns.splice(0, store.campaigns.length);
  store.offers.splice(0, store.offers.length);
  store.messages.splice(0, store.messages.length);
  saveStore();

  return { bookings, waitlist: await listWaitlist() };
}

module.exports = {
  createWaitlistEntry,
  listWaitlist,
  createOffersForCancellation,
  getOfferByToken,
  claimOffer,
  declineOffer,
  advanceCascade,
  resetDemoData,
  _store: store,
};
