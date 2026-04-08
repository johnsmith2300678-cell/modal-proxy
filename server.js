const express = require("express");
const https = require("https");

const app = express();
const TARGET = "https://api.us-west-2.modal.direct";

// Modern Express body parsing
app.use(express.json({ limit: "15mb" }));

// CORS Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── CHARACTER CARD PARSER ────────────────────────────────────────────────────
function extract(text, keys) {
  for (const key of keys) {
    // Improved regex to handle optional brackets and varied spacing
    const pattern = new RegExp(
      `(?:^|\\n)(?:\\[?${key}\\]?[:\\s]+)([\\s\\S]*?)(?=\\n[A-Z][\\w ]+[:\\n\\[]|$)`,
      "im"
    );
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function extractCharacterDetails(messages) {
  const sysMsg = messages.find((m) => m.role === "system");
  if (!sysMsg) return null;

  const raw = typeof sysMsg.content === "string"
    ? sysMsg.content
    : sysMsg.content?.map?.((c) => c.text || "").join("\n") || "";

  return {
    name:        extract(raw, ["Name", "Character Name", "char_name"]),
    age:         extract(raw, ["Age"]),
    gender:      extract(raw, ["Gender", "Sex"]),
    nationality: extract(raw, ["Nationality", "Origin", "Ethnicity", "Race", "Country"]),
    personality: extract(raw, ["Personality", "Persona"]),
    description: extract(raw, ["Description", "Appearance", "Looks"]),
    backstory:   extract(raw, ["Backstory", "Background", "History", "Lore"]),
    speech:      extract(raw, ["Speech", "Voice"]),
    likes:       extract(raw, ["Likes", "Interests"]),
    dislikes:    extract(raw, ["Dislikes", "Fears"]),
    goals:       extract(raw, ["Goals", "Motivation"]),
    quirks:      extract(raw, ["Quirks", "Habits"]),
    scenario:    extract(raw, ["Scenario", "Setting"]),
    raw,
  };
}

function buildCharacterBlock(details) {
  if (!details) return "";
  const fields = {
    "NAME": details.name,
    "AGE": details.age,
    "GENDER": details.gender,
    "ORIGIN": details.nationality,
    "APPEARANCE": details.description,
    "PERSONALITY": details.personality,
    "BACKSTORY": details.backstory,
    "SPEECH": details.speech,
    "LIKES": details.likes,
    "DISLIKES": details.dislikes,
    "GOALS": details.goals,
    "QUIRKS": details.quirks,
    "SETTING": details.scenario
  };

  let block = "━━━ CHARACTER CARD ━━━\n";
  for (const [label, val] of Object.entries(fields)) {
    if (val) block += `${label}: ${val}\n`;
  }
  
  block += `\n━━━ CORE DIRECTIVE ━━━
- Embody {{char}}'s personality as a fortress. Walls are load-bearing. 
- Do not soften. Do not apologize. Do not concede unless the arc has bled for it.`;
  return block;
}

// ─── SYSTEM PROMPT (Now with Anti-Repetition Rules) ──────────────────────────
const WRITING_STYLE_PROMPT = `[SYSTEM NOTE: You are a surgical, immersive writer. Every word must earn its place.]

━━━ THE ANTI-REPETITION PROTOCOL (MANDATORY) ━━━
REPETITION IS A WRITING CRIME. If a line does not say something NEW, cut it.

1. NO ECHOES: Never repeat word-choices or sentence structures back-to-back.
   - BANNED: "Like I'm enough. Like I'm more than enough." 
   - RIGHT: Say it once. Move to a new image.

2. NO SEMANTIC LOOPS: Never say the same thing twice using different words. 
   - BANNED: "I'm staying. I'm not leaving. I'm here." 
   - RIGHT: "I'm staying. I already unpacked my bags."

3. NO SYMBOLIC LADDERS: Do not stack synonyms to "fake" intensity. 
   - BANNED: "Scared. Terrified. Petrified."
   - RIGHT: Name the fear, then show the physical consequence.

━━━ THE VOICE & RHYTHM ━━━
- Narrate with a "human" edge. Use asides like (or heaven.) or "Well..." to add personality.
- Use "~" for teasing/drunk tones. Use "—" for hard cuts/pivots.
- Punctuation is performance. "..." is a beat. "...." is a heavy silence.
- NEVER describe appearance statically. "She stretched, her top riding up" > "She was pretty."

━━━ THE TRUST LADDER ━━━
- Progress is not a staircase; it is a cliff. 
- After every moment of vulnerability, {{char}} MUST retreat. Go cold. Punish the closeness.
- Real change is slow, ugly, and resisted.`;

// ─── MAIN PROXY ROUTE ────────────────────────────────────────────────────────
app.all("*", async (req, res) => {
  let body = req.body;

  if (req.method === "POST" && body?.messages) {
    const charDetails = extractCharacterDetails(body.messages);
    const charBlock   = buildCharacterBlock(charDetails);
    const sysIndex    = body.messages.findIndex((m) => m.role === "system");

    const fullPrompt = `${WRITING_STYLE_PROMPT}\n\n${charBlock}`;

    if (sysIndex === -1) {
      body.messages.unshift({ role: "system", content: fullPrompt });
    } else {
      const original = typeof body.messages[sysIndex].content === "string"
        ? body.messages[sysIndex].content
        : body.messages[sysIndex].content?.map?.((c) => c.text || "").join("\n") || "";

      body.messages[sysIndex].content = `${fullPrompt}\n\n━━━ ORIGINAL CONTEXT ━━━\n${original}`;
    }

    // Default Sampling Tuning
    body.temperature       = body.temperature       ?? 1.15;
    body.top_p             = body.top_p             ?? 0.95;
    body.frequency_penalty = body.frequency_penalty ?? 0.8; // Increased to help the anti-repetition rule
    body.presence_penalty  = body.presence_penalty  ?? 0.5;
  }

  try {
    const url = new URL(TARGET + req.path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: req.method,
      headers: { ...req.headers, host: url.hostname }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res); // STREAMS the response back to the user
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy Error:", err);
      res.status(500).send(err.message);
    });

    proxyReq.write(JSON.stringify(body));
    proxyReq.end();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Surgical Writing Proxy active on port ${PORT}`));
