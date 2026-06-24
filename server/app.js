require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const cors = require("cors");
const path = require("path");
const calendar = require("./calendar");
const waitlist = require("./waitlist");
const openai = require("./openai");

const ROOT = path.join(__dirname, "..");
const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_KEY = "123456";
const app = express();

const calendarReady = calendar.initGoogleCalendar().then((connected) => {
  if (connected) console.log("Google Calendar connected");
  else console.log("Using in-memory bookings (add GOOGLE_CALENDAR_ID + credentials for Calendar sync)");
  return connected;
});

app.use(cors());
app.use(express.json());

app.use("/api", async (_req, _res, next) => {
  try {
    await calendarReady;
    next();
  } catch (err) {
    next(err);
  }
});

// Render & local: Express serves HTML/JS/CSS. Netlify CDN serves static files; functions only handle /api.
const serveStatic = process.env.SERVE_STATIC !== "false";
if (serveStatic) {
  app.use(express.static(ROOT, { index: ["index.html"] }));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(ROOT, "index.html"));
  });
  app.get("/admin.html", (_req, res) => {
    res.sendFile(path.join(ROOT, "admin.html"));
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    calendar: !!process.env.GOOGLE_CALENDAR_ID,
    ai: openai.isEnabled(),
  });
});

function checkAdmin(req, res) {
  const expectedUser = process.env.ADMIN_USER || DEFAULT_ADMIN_USER;
  const expected = process.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
  if (req.query.user !== expectedUser || req.query.key !== expected) {
    res.status(401).json({ error: "Falscher Benutzername oder falsches Passwort." });
    return false;
  }
  return true;
}

function requestBaseUrl(req) {
  if (process.env.WAITLIST_PUBLIC_BASE_URL) return process.env.WAITLIST_PUBLIC_BASE_URL;
  return `${req.protocol}://${req.get("host")}`;
}

app.get("/api/slots", async (req, res, next) => {
  try {
    const { date, tzOffset } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Datumsabfrage erforderlich (YYYY-MM-DD)" });
    }
    const slots = await calendar.getAvailableSlots(date, { timezoneOffset: tzOffset });
    res.json({ date, slots });
  } catch (err) {
    next(err);
  }
});

app.get("/api/bookings", async (req, res, next) => {
  try {
    if (!checkAdmin(req, res)) return;
    const bookings = await calendar.listBookings();
    res.json({ bookings });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/bookings", async (req, res, next) => {
  try {
    if (!checkAdmin(req, res)) return;
    const bookings = await calendar.listBookings();
    const cancelled = bookings.find((booking) => booking.id === req.query.id);
    const deleted = await calendar.deleteBooking(req.query.id);
    const waitlistResult = await waitlist.createOffersForCancellation(cancelled || deleted, {
      baseUrl: requestBaseUrl(req),
    });
    res.json({ deleted, waitlist: waitlistResult });
  } catch (err) {
    next(err);
  }
});

app.post("/api/bookings", async (req, res, next) => {
  try {
    const { date, start, name, email, notes, service } = req.body;
    if (!date || !start || !name || !email) {
      return res.status(400).json({ error: "Datum, Startzeit, Name und E-Mail sind erforderlich" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse" });
    }
    const booking = await calendar.createBooking({
      date,
      start,
      name: name.trim(),
      email: email.trim(),
      notes,
      service,
    });
    res.status(201).json({ booking });
  } catch (err) {
    next(err);
  }
});

app.get("/api/waitlist", async (req, res, next) => {
  try {
    if (!checkAdmin(req, res)) return;
    const data = await waitlist.listWaitlist({ baseUrl: requestBaseUrl(req) });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

app.post("/api/waitlist", async (req, res, next) => {
  try {
    if (!checkAdmin(req, res)) return;
    const entry = waitlist.createWaitlistEntry(req.body);
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

app.get("/api/waitlist-offer", async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Angebots-Token erforderlich" });
    const offer = await waitlist.getOfferByToken(token, { baseUrl: requestBaseUrl(req) });
    res.json({ offer });
  } catch (err) {
    next(err);
  }
});

app.post("/api/waitlist-offer", async (req, res, next) => {
  try {
    const token = req.body?.token || req.query.token;
    if (!token) return res.status(400).json({ error: "Angebots-Token erforderlich" });
    const action = req.body?.action || req.query.action || "accept";
    const result = action === "decline"
      ? await waitlist.declineOffer(token, { baseUrl: requestBaseUrl(req) })
      : await waitlist.claimOffer(token);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

async function handleDemoReset(req, res, next) {
  try {
    if (!checkAdmin(req, res)) return;
    const data = await waitlist.resetDemoData();
    res.json(data);
  } catch (err) {
    next(err);
  }
}

app.post("/api/demo/reset", handleDemoReset);
app.post("/api/demo-reset", handleDemoReset);

app.post("/api/chat", async (req, res, next) => {
  try {
    const { message, context } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: "Nachricht erforderlich" });
    }
    const result = await openai.parseBookingIntent(message.trim(), context);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Serverfehler" });
});

module.exports = app;
