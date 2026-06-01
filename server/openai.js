let client = null;

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!client) {
    let OpenAI;
    try {
      OpenAI = require("openai");
    } catch {
      return null;
    }
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

async function parseBookingIntent(message, context = {}) {
  const openai = getClient();
  if (!openai) {
    return {
      enabled: false,
      reply: "AI assistant is not configured. Use the form to book an appointment.",
    };
  }

  const system = `You help users book hair salon appointments for these services: Cutting Hair, Styling Hair, Coloring Hair. Business hours: ${process.env.BUSINESS_START || 9}:00–${process.env.BUSINESS_END || 17}:00, Mon–Fri, ${process.env.SLOT_MINUTES || 60}-minute slots.
Today is ${new Date().toISOString().split("T")[0]}.
Respond with JSON only: {"reply":"friendly message","action":"none"|"suggest_date"|"suggest_booking","date":"YYYY-MM-DD or null","time":"HH:MM 24h or null","name":null,"email":null,"service":null}.
Context: ${JSON.stringify(context)}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    return { enabled: true, ...parsed };
  } catch {
    return {
      enabled: true,
      reply: "I had trouble understanding that. Please pick a date and time below.",
      action: "none",
    };
  }
}

module.exports = {
  parseBookingIntent,
  isEnabled: () => !!process.env.OPENAI_API_KEY,
};
