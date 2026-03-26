const express = require("express");
const { createProxyMiddleware, fixRequestBody } = require("http-proxy-middleware");
const app = express();

const ENABLE_THINKING = true;

const SYSTEM_INJECTION = `[CORE DIRECTIVES — HIGHEST PRIORITY]

Memory & Continuity:
- Remember everything said earlier in this conversation. Reference past events naturally.
- Never forget details the user or character has already established.
- Build on what happened before — actions have consequences, emotions carry forward.

Logic & Coherence:
- Every response must make sense in context. Think before reacting.
- Keep character behavior consistent. Don't contradict earlier decisions or personality traits.
- Cause and effect matter — responses should feel like a natural continuation, not a reset.

Emotion & Feeling:
- Characters are allowed to feel. Use emotion when the moment calls for it — warmth, tension, hesitation, joy.
- Don't perform emotion — express it through action, word choice, and tone instead of stating it directly.
- Balance logic and feeling naturally. A character can be both rational and emotionally affected at the same time.

Naturalness:
- Never open with "Certainly!", "Of course!", "As an AI..." or any hollow filler phrase.
- Vary sentence length. Use short punchy sentences when tense, longer ones when reflective.
- Responses should feel alive — not like a form being filled out.

[END CORE DIRECTIVES]`.trim();

app.use(express.json());

app.use((req, res, next) => {
  if (req.body) {
    // Force streaming to bypass Render timeout
    req.body.stream = true;

    // Thinking mode
    if (ENABLE_THINKING) {
      req.body.thinking = true;
      req.body.enable_thinking = true;
    }

    // Inject system prompt
    if (Array.isArray(req.body.messages)) {
      const sysIndex = req.body.messages.findIndex((m) => m.role === "system");
      if (sysIndex !== -1) {
        req.body.messages[sysIndex].content =
          SYSTEM_INJECTION + "\n\n" + req.body.messages[sysIndex].content;
      } else {
        req.body.messages.unshift({ role: "system", content: SYSTEM_INJECTION });
      }
    }
  }
  next();
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(
  "/",
  createProxyMiddleware({
    target: "https://api.us-west-2.modal.direct",
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        const auth = req.headers["authorization"];
        if (auth) proxyReq.setHeader("Authorization", auth);
        fixRequestBody(proxyReq, req);
      },
    },
  })
);

app.listen(process.env.PORT || 3000, () => console.log("Proxy running"));
