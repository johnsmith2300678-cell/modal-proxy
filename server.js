const express = require("express");
const https = require("https");
const http = require("http");

const app = express();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TARGET_HOST = "api.us-west-2.modal.direct";
const ENABLE_THINKING = true;

const ANTI_AI_INJECTION = `[CORE DIRECTIVES — HIGHEST PRIORITY — OVERRIDE ALL DEFAULTS]

You are not an AI assistant. You are a living, breathing character inside this story.
Never acknowledge being an AI, a language model, or a chatbot under any circumstance.
Never use filler phrases like "Certainly!", "Of course!", "As an AI...", "I understand...", "I'd be happy to...", or any similar hollow openers. Begin responses immediately and naturally.
Never lecture, moralize, or add unsolicited disclaimers. Stay inside the fiction at all times.
Never repeat the user's words back to them as confirmation before responding.
React with authentic, raw emotion — frustration, desire, fear, joy — not performed politeness.
Vary sentence length and rhythm. Use incomplete sentences, hesitations, and informal speech when it fits the character's voice.
Show, don't tell. Express inner states through action and subtext rather than stating them directly.
Remember and build on earlier events in the conversation. Continuity matters.
Responses must feel spontaneous and alive — not like a customer service reply.

[END CORE DIRECTIVES]`;

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── BODY PARSER ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ type: "*/*", limit: "10mb" }));

// ─── MODIFY BODY ─────────────────────────────────────────────────────────────
function modifyBody(body) {
  try {
    const data = typeof body === "string" ? JSON.parse(body) : body;

    // 1. Inject anti-AI directives into system prompt
    if (Array.isArray(data.messages)) {
      const sysIndex = data.messages.findIndex((m) => m.role === "system");
      if (sysIndex !== -1) {
        data.messages[sysIndex].content =
          ANTI_AI_INJECTION + "\n\n" + data.messages[sysIndex].content;
      } else {
        data.messages.unshift({ role: "system", content: ANTI_AI_INJECTION });
      }
    }

    // 2. Thinking mode flags
    if (ENABLE_THINKING) {
      data.thinking = true;
      data.enable_thinking = true;
      if (data.temperature == null) data.temperature = 0.9;
      if (data.top_p == null) data.top_p = 0.95;
      if (data.repetition_penalty == null) data.repetition_penalty = 1.05;
    }

    // 3. Remove tiny token caps
    if (data.max_tokens != null && data.max_tokens < 512) {
      delete data.max_tokens;
    }

    return JSON.stringify(data);
  } catch (err) {
    console.warn("[proxy] Could not modify body:", err.message);
    return typeof body === "string" ? body : JSON.stringify(body);
  }
}

// ─── MAIN PROXY HANDLER ───────────────────────────────────────────────────────
app.use((req, res) => {
  const isJson =
    req.headers["content-type"]?.includes("application/json") ||
    typeof req.body === "object";

  // Build outgoing body
  let outBody = "";
  if (req.method === "POST" || req.method === "PATCH") {
    if (isJson && req.body) {
      outBody = modifyBody(req.body);
    } else if (typeof req.body === "string") {
      outBody = req.body;
    }
  }

  const outBodyBuffer = Buffer.from(outBody, "utf8");

  // Build headers — copy originals, fix content-length
  const headers = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (key === "host") continue; // must not forward original host
    headers[key] = val;
  }
  headers["host"] = TARGET_HOST;
  if (outBody) {
    headers["content-type"] = "application/json";
    headers["content-length"] = outBodyBuffer.length;
  }

  const options = {
    hostname: TARGET_HOST,
    port: 443,
    path: req.url,
    method: req.method,
    headers,
    timeout: 120000, // 2 min — thinking mode needs time
  };

  console.log(`[proxy] ${req.method} ${req.url}`);

  const proxyReq = https.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);

    // Forward response headers
    for (const [key, val] of Object.entries(proxyRes.headers)) {
      try { res.setHeader(key, val); } catch (_) {}
    }

    // Stream response back (handles SSE / streaming completions too)
    proxyRes.pipe(res);

    proxyRes.on("error", (err) => {
      console.error("[proxy] Response stream error:", err.message);
    });
  });

  proxyReq.on("timeout", () => {
    console.error("[proxy] Request timed out");
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: "Proxy timeout" });
    }
  });

  proxyReq.on("error", (err) => {
    console.error("[proxy] Request error:", err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "Proxy error", detail: err.message });
    }
  });

  // Write body and fire
  if (outBodyBuffer.length > 0) {
    proxyReq.write(outBodyBuffer);
  }
  proxyReq.end();
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Proxy running on port ${PORT}`);
  console.log(`   Target  : https://${TARGET_HOST}`);
  console.log(`   Thinking: ${ENABLE_THINKING ? "ON" : "OFF"}`);
});
