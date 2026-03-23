const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TARGET = "https://api.us-west-2.modal.direct";
const ENABLE_THINKING = true;

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

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── BODY REWRITER (runs BEFORE proxy) ───────────────────────────────────────
app.use((req, res, next) => {
  // Only intercept POST/PATCH with a JSON body
  if (
    (req.method !== "POST" && req.method !== "PATCH") ||
    !req.headers["content-type"]?.includes("application/json")
  ) {
    return next();
  }

  let chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(raw);

      // ── 1. Inject anti-AI directives ────────────────────────────────────
      if (Array.isArray(body.messages)) {
        const sysIndex = body.messages.findIndex((m) => m.role === "system");
        if (sysIndex !== -1) {
          body.messages[sysIndex].content =
            ANTI_AI_INJECTION + "\n\n" + body.messages[sysIndex].content;
        } else {
          body.messages.unshift({ role: "system", content: ANTI_AI_INJECTION });
        }
      }

      // ── 2. Thinking mode ─────────────────────────────────────────────────
      if (ENABLE_THINKING) {
        body.thinking = true;
        body.enable_thinking = true;
        if (body.temperature == null) body.temperature = 0.9;
        if (body.top_p == null) body.top_p = 0.95;
        if (body.repetition_penalty == null) body.repetition_penalty = 1.05;
      }

      // ── 3. Remove tiny token caps ────────────────────────────────────────
      if (body.max_tokens != null && body.max_tokens < 512) {
        delete body.max_tokens;
      }

      // Re-inject modified body as a readable stream for the proxy
      const modified = JSON.stringify(body);
      req.headers["content-length"] = Buffer.byteLength(modified).toString();

      // Replace the stream so the proxy reads the new body
      const { Readable } = require("stream");
      const readable = Readable.from([Buffer.from(modified, "utf8")]);
      readable.headers = req.headers; // keep reference if needed
      Object.assign(req, readable);
      req.headers = req.headers; // ensure headers stay on req

      // Monkey-patch: proxy reads req like a stream, so we override its pipe
      req.pipe = (dest, opts) => readable.pipe(dest, opts);
      req.unpipe = (dest) => readable.unpipe(dest);
      req.on = (event, handler) => {
        readable.on(event, handler);
        return req;
      };
      req.resume = () => { readable.resume(); return req; };

      console.log("[proxy] Body modified OK");
    } catch (err) {
      console.warn("[proxy] Body parse failed, passing through:", err.message);
    }

    next();
  });

  req.on("error", (err) => {
    console.error("[proxy] Request stream error:", err.message);
    next();
  });
});

// ─── PROXY ───────────────────────────────────────────────────────────────────
app.use(
  "/",
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        const auth = req.headers["authorization"];
        if (auth) proxyReq.setHeader("Authorization", auth);
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
