const calendar = require("../server/calendar");

let ready = null;

function ensureReady() {
  if (!ready) ready = calendar.initGoogleCalendar();
  return ready;
}

module.exports = async function handler(req, res) {
  try {
    await ensureReady();
    const { date, tzOffset } = req.query || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Datumsabfrage erforderlich (YYYY-MM-DD)" });
    }

    const slots = await calendar.getAvailableSlots(date, { timezoneOffset: tzOffset });
    return res.status(200).json({ date, slots });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Serverfehler" });
  }
};
