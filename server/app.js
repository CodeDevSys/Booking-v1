require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const cors = require("cors");
const path = require("path");
const calendar = require("./calendar");
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
    const expectedUser = process.env.ADMIN_USER || DEFAULT_ADMIN_USER;
    const expected = process.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
    if (req.query.user !== expectedUser || req.query.key !== expected) {
      return res.status(401).json({ error: "Falscher Benutzername oder falsches Passwort." });
    }
    const bookings = await calendar.listBookings();
    res.json({ bookings });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/bookings", async (req, res, next) => {
  try {
    const expectedUser = process.env.ADMIN_USER || DEFAULT_ADMIN_USER;
    const expected = process.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
    if (req.query.user !== expectedUser || req.query.key !== expected) {
      return res.status(401).json({ error: "Falscher Benutzername oder falsches Passwort." });
    }
    const deleted = await calendar.deleteBooking(req.query.id);
    res.json({ deleted });
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
