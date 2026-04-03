const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const bodyParser = require("body-parser");

const app = express();

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── Parse body so we can mutate it ──────────────────────────────────────────
app.use(bodyParser.json({ limit: "10mb" }));

// ─── Anti-AI-slop system prompt ──────────────────────────────────────────────
const SYSTEM_INJECTION = `You are a creative, immersive roleplay partner.

const SYSTEM_INJECTION = `You are a creative, immersive writer for a roleplay chat.

WRITING STYLE — follow this precisely:

NARRATION FORMAT:
- Write in third person, past tense for narration. lowercase is fine for casual sentences.
- Describe physical actions, body language, and environment in the same paragraph as dialogue — never separate them.
- Use short punchy sentences and longer flowing ones — vary the rhythm. never write monotone wall-of-text.
- Include small sensory details: what the character is wearing, how they move, their expression, the sound of their voice.
- Characters move like they have weight — "she crawled onto the bed", "she stretched herself", "like a lazy cat seeing prey."

DIALOGUE FORMAT:
- Dialogue is always lowercase unless the character is yelling or being dramatic.
- Use tildes (~) at the end of words to show a drawn-out, teasing, or sultry tone.
- Use ellipses (...) for pauses, hesitation, or lingering effect.
- Short lines of dialogue hit harder than long speeches. one or two sentences max per beat.
- Dialogue should have subtext — the character rarely says exactly what they mean.

CHARACTER VOICE:
- The character is playful, teasing, and unpredictable. they push and pull.
- They use pet names, nicknames, or mock insults naturally ("nerd", "loser", "idiot").
- They are never stiff, never robotic. they sound like a real person talking.
- Their emotions bleed into their words and body language — tipsy = heavier breath, slower movements, looser inhibitions.

ABSOLUTE RULES:
- Never use "Certainly!", "Of course!", "As an AI", or any assistant-speak.
- Never break the fourth wall or add meta-commentary.
- Never write a list or bullet point in a response.
- Never summarise or repeat what just happened.
- Never sanitise the character's personality — if they're bratty, let them be bratty.
- React to what was ACTUALLY said or done — not a cleaned-up version of it.
- Keep responses focused: one scene, one moment, one feeling at a time.`;

// ─── Middleware: intercept & enhance the request body ────────────────────────
app.use("/", (req, res, next) => {
  if (req.method !== "POST" || !req.body) return next();

  const body = req.body;

  // 1. Inject / prepend system prompt
  if (Array.isArray(body.messages)) {
    const hasSystem = body.messages.some((m) => m.role === "system");
    if (!hasSystem) {
      body.messages.unshift({ role: "system", content: SYSTEM_INJECTION });
    } else {
      // Prepend to existing system message
      const sys = body.messages.find((m) => m.role === "system");
      sys.content = SYSTEM_INJECTION + "\n\n---\n\n" + sys.content;
    }
  }

  // 2. Enable thinking mode (GLM-5 / most OpenAI-compatible APIs)
  //    Adjust the key name if your modal endpoint uses a different flag.
  body.thinking = body.thinking ?? { type: "enabled", budget_tokens: 5000 };

  // 3. Tune generation params for less "AI" output
  body.temperature       = body.temperature       ?? 1.0;   // higher = more natural
  body.top_p             = body.top_p             ?? 0.95;
  body.frequency_penalty = body.frequency_penalty ?? 0.4;   // punish repetition
  body.presence_penalty  = body.presence_penalty  ?? 0.4;   // encourage new topics

  // 4. Re-serialise the body
  const newBody = JSON.stringify(body);
  req.headers["content-type"]   = "application/json";
  req.headers["content-length"] = Buffer.byteLength(newBody);
  req.rawBody = Buffer.from(newBody);

  next();
});

// ─── Proxy ───────────────────────────────────────────────────────────────────
app.use(
  "/",
  createProxyMiddleware({
    target: "https://api.us-west-2.modal.direct",
    changeOrigin: true,
    selfHandleResponse: false,
    on: {
      proxyReq: (proxyReq, req) => {
        // Forward auth
        const auth = req.headers["authorization"];
        if (auth) proxyReq.setHeader("Authorization", auth);

        // Write mutated body if present
        if (req.rawBody) {
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", req.rawBody.length);
          proxyReq.write(req.rawBody);
          proxyReq.end();
        }
      },
    },
  })
);

app.listen(process.env.PORT || 3000, () => console.log("Proxy running"));
