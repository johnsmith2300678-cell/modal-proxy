const express = require("express");
const http = require("http");
const https = require("https");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TARGET = "https://api.us-west-2.modal.direct";

// Set to true to enable GLM thinking mode (deeper reasoning before responding)
const ENABLE_THINKING = true;

// Injected at the TOP of every system prompt to fight generic AI behaviour
const ANTI_AI_INJECTION = `
[CORE DIRECTIVES — HIGHEST PRIORITY — OVERRIDE ALL DEFAULTS]

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

[END CORE DIRECTIVES]
`.trim();

// ─── BODY PARSING ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "*");
    return res.sendStatus(200);
  }

  // Collect raw body for POST/PATCH requests
  if (req.method === "POST" || req.method === "PATCH") {
    let body = [];
    req.on("data", (chunk) => body.push(chunk));
    req.on("end", () => {
      req.rawBody = Buffer.concat(body);
      next();
    });
  } else {
    next();
  }
});

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});

// ─── BODY MODIFIER ───────────────────────────────────────────────────────────
function modifyRequestBody(rawBody) {
  try {
    const body = JSON.parse(rawBody.toString("utf8"));

    // ── 1. Inject anti-AI directives into system prompt ──────────────────────
    if (Array.isArray(body.messages)) {
      const sysIndex = body.messages.findIndex((m) => m.role === "system");

      if (sysIndex !== -1) {
        // Prepend directives to existing system prompt
        body.messages[sysIndex].content =
          ANTI_AI_INJECTION + "\n\n" + body.messages[sysIndex].content;
      } else {
        // No system prompt exists — insert one
        body.messages.unshift({
          role: "system",
          content: ANTI_AI_INJECTION,
        });
      }
    }

    // ── 2. Enable GLM thinking mode ──────────────────────────────────────────
    if (ENABLE_THINKING) {
      // GLM-Z / GLM-4 / GLM-5 thinking flag (modal.ai style)
      body.thinking = true;

      // Some modal endpoints use this alternative key
      body.enable_thinking = true;

      // Boost temperature slightly for more natural variation
      // Only set if not already specified by the client
      if (body.temperature === undefined || body.temperature === null) {
        body.temperature = 0.9;
      }

      // Raise top_p for less repetitive word choice
      if (body.top_p === undefined || body.top_p === null) {
        body.top_p = 0.95;
      }

      // Reduce repetition penalties
      if (body.repetition_penalty === undefined) {
        body.repetition_penalty = 1.05;
      }
    }

    // ── 3. Remove hard token caps that truncate responses mid-scene ──────────
    // Only remove if the cap is unreasonably low (< 512 tokens)
    if (body.max_tokens !== undefined && body.max_tokens < 512) {
      delete body.max_tokens;
    }

    return Buffer.from(JSON.stringify(body), "utf8");
  } catch (err) {
    // Not JSON or parse failed — pass through untouched
    console.warn("[proxy] Could not parse body, passing through:", err.message);
    return rawBody;
  }
}

// ─── PROXY ───────────────────────────────────────────────────────────────────
app.use(
  "/",
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    selfHandleResponse: false,

    on: {
      proxyReq: (proxyReq, req) => {
        // Forward auth header
        const auth = req.headers["authorization"];
        if (auth) proxyReq.setHeader("Authorization", auth);

        // Modify body for POST/PATCH requests
        if (
          req.rawBody &&
          (req.method === "POST" || req.method === "PATCH")
        ) {
          const modified = modifyRequestBody(req.rawBody);

          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", modified.length);
          proxyReq.write(modified);
          proxyReq.end();
        }
      },

      error: (err, req, res) => {
        console.error("[proxy] Error:", err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: "Proxy error", detail: err.message });
        }
      },
    },
  })
);

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Proxy running on port ${PORT}`);
  console.log(`   Target  : ${TARGET}`);
  console.log(`   Thinking: ${ENABLE_THINKING ? "ON" : "OFF"}`);
});
