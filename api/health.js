const openai = require("../server/openai");

module.exports = async function handler(_req, res) {
  res.status(200).json({
    ok: true,
    calendar: !!process.env.GOOGLE_CALENDAR_ID,
    ai: openai.isEnabled(),
  });
};
