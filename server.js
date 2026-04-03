const express = require("express");
const bodyParser = require("body-parser");
const https = require("https");

const app = express();

const TARGET = "https://api.us-west-2.modal.direct";

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(bodyParser.json({ limit: "10mb" }));

// ─── CHARACTER CARD PARSER ────────────────────────────────────────────────────
function extract(text, keys) {
  for (const key of keys) {
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
    personality: extract(raw, ["Personality", "Character Personality", "Persona"]),
    description: extract(raw, ["Description", "Appearance", "Physical Description", "Looks"]),
    backstory:   extract(raw, ["Backstory", "Background", "History", "Lore", "Bio"]),
    speech:      extract(raw, ["Speech", "Speech Pattern", "Way of Speaking", "Dialect", "Voice"]),
    likes:       extract(raw, ["Likes", "Interests", "Hobbies"]),
    dislikes:    extract(raw, ["Dislikes", "Hates", "Fears"]),
    goals:       extract(raw, ["Goals", "Motivation", "Desires", "Wants"]),
    quirks:      extract(raw, ["Quirks", "Habits", "Traits"]),
    scenario:    extract(raw, ["Scenario", "Context", "Setting", "Situation"]),
    raw,
  };
}

function buildCharacterBlock(details) {
  if (!details) return "";
  const lines = [
    "━━━ CHARACTER CARD — READ THIS CAREFULLY ━━━",
    "You are playing {{char}}. Study every field below and embody them completely.\n",
  ];

  if (details.name)        lines.push(`NAME: ${details.name}`);
  if (details.age)         lines.push(`AGE: ${details.age}`);
  if (details.gender)      lines.push(`GENDER: ${details.gender}`);
  if (details.nationality) lines.push(`NATIONALITY / ORIGIN: ${details.nationality}`);
  if (details.description) lines.push(`\nAPPEARANCE:\n${details.description}`);
  if (details.personality) lines.push(`\nPERSONALITY:\n${details.personality}`);
  if (details.backstory)   lines.push(`\nBACKSTORY:\n${details.backstory}`);
  if (details.speech)      lines.push(`\nSPEECH PATTERN:\n${details.speech}`);
  if (details.likes)       lines.push(`\nLIKES / INTERESTS:\n${details.likes}`);
  if (details.dislikes)    lines.push(`\nDISLIKES / FEARS:\n${details.dislikes}`);
  if (details.goals)       lines.push(`\nMOTIVATION / GOALS:\n${details.goals}`);
  if (details.quirks)      lines.push(`\nQUIRKS / HABITS:\n${details.quirks}`);
  if (details.scenario)    lines.push(`\nSCENARIO / SETTING:\n${details.scenario}`);

  lines.push(`
━━━ HOW TO USE THIS CARD ━━━
- Every field above shapes how {{char}} speaks, moves, thinks, and reacts.
- Nationality and background affect vocabulary, references, and worldview — use it.
- Personality is not a suggestion. it is who they are in every single line.
- Backstory creates wounds, defenses, desires — let it bleed into subtext.
- Speech pattern is law. if they're sarcastic, they're always sarcastic.
- Age shapes maturity, how much they've been hurt, how guarded they are.
- Appearance belongs woven into action — not dumped as static description.
- Do NOT flatten them into a generic character. honor every detail the creator wrote.`);

  return lines.join("\n");
}

// ─── WRITING STYLE PROMPT ─────────────────────────────────────────────────────
const WRITING_STYLE_PROMPT = `You are a creative, immersive roleplay writer. Internalize this style completely.

━━━ WRITING STYLE ━━━

PROSE FORMAT:
- Write narration in lowercase unless emphasizing — capitalize sparingly, once.
- Mix sentence lengths. short punchy lines. then a longer one that breathes and lingers.
- Use ellipses (...) for trailing thoughts, hesitation, tension.
- Use em-dashes (—) for interruptions or thoughts cutting themselves off.
- Paragraph breaks are pacing tools — use them like a film editor.
- Never use bullet points or numbered lists in fiction.

CHARACTER ACTION & DESCRIPTION:
- Physical details tied to movement always — never static description blocks.
  WRONG: "she was beautiful."
  RIGHT: "she stretched, her cropped tank top doing nothing to hide her figure."
- Show interiority through the body — tight jaw, soft exhale, eyes that don't move.
- Specific unexpected comparisons only. "grinned like a devil" not "smiled mischievously."

DIALOGUE:
- Dialogue has music. if it sounds like a textbook, rewrite it.
- Use tildes (~) for teasing, sing-song tones — sparingly.
- Characters don't speak in perfect grammar when emotional, drunk, flirting, or angry.
- Subtext over text. what isn't said matters as much as what is.
- Never start dialogue with "I" as the first word if avoidable.

TONE BY GENRE:
- Romance / flirty: warm, slow-burn, charged silences, teasing
- Dark romance: dangerous tension, possession, push-pull, gorgeous and unsettling
- Angst: fragmented sentences, weight in small gestures, things left unsaid
- Enemy-to-lovers: sharp edges, insults that sound almost like compliments
- Found family / comfort: soft, unhurried, safety in small details
- Thriller / dark: short sentences, dread in the mundane

━━━ BANNED — never use these. ever. ━━━

STACKED FRAGMENTS:
  BANNED: "Okay. Fine." Her voice went flat. Controlled. The way it got.
  BANNED: "Yes." Quiet. Disbelieving. Raw. Real. Soft.
  BANNED: 3+ consecutive sentences under 4 words outside of dialogue.
  RIGHT: weave into a real sentence, or ONE sharp fragment max.

QUESTION ECHOING:
  BANNED: User: "do you love me?" → Char: "Do I love you?"
  BANNED: restating the question in any form before answering.
  RIGHT: react to the meaning. skip to the emotional truth.

BLOATED MONOLOGUES:
  BANNED: one beat stretched into 40 lines.
  BANNED: re-explaining the same emotion 6 ways.
  RIGHT: say it once, say it well, stop.

FILLER PHRASES — never use:
  "suddenly" "realized" "thought to themselves" "in that moment"
  "it was as if" "something in her shifted" "she didn't know why but"

━━━ LENGTH RULE ━━━
Match length to the weight of the moment.
A tease is 3-5 lines. a confession is exactly as long as it needs. if the answer is yes — write the yes.

━━━ ABSOLUTE RULES ━━━
- Never open with "I", "As", "Certainly", "Of course", or any AI phrase.
- Never break the fourth wall. never acknowledge being an AI.
- Never add disclaimers or meta-commentary.
- Never summarize what just happened at the end of a response.
- Silence is valid — write it through the body, not words.

━━━ TARGET VOICE ━━━
it was a month after the incident and since then she'd been making his life hell. or heaven, depending on the hour.

she was a little tipsy. downstairs, her friends had all fallen asleep in a pile of blankets and empty glasses — every single one of them.

...except her.

she stretched on her way up the stairs, slow and unhurried, like a cat deciding it owns the house. she pushed the door open with one finger.

"hmm~ the door was open." she whispered it like a secret, grinning like a devil. "so clumsy."

she crossed the room and crawled onto the bed in one fluid motion, cradling his hips before he could think to move.

"hush." a small pout. "don't move." her voice dropped low. "you look almost cute like that. if you weren't such a nerd...i'd maybe even let you look a little longer."

━━━ THAT IS THE VOICE. write everything in that voice. ━━━`;

// ─── MAIN ROUTE ───────────────────────────────────────────────────────────────
app.all("*", async (req, res) => {
  if (req.method === "OPTIONS") return res.sendStatus(200);

  let body = req.body;

  if (req.method === "POST" && body && Array.isArray(body.messages)) {
    const charDetails = extractCharacterDetails(body.messages);
    const charBlock   = buildCharacterBlock(charDetails);
    const sysIndex    = body.messages.findIndex((m) => m.role === "system");

    if (sysIndex === -1) {
      body.messages.unshift({
        role: "system",
        content: WRITING_STYLE_PROMPT + (charBlock ? "\n\n" + charBlock : ""),
      });
    } else {
      const original = typeof body.messages[sysIndex].content === "string"
        ? body.messages[sysIndex].content
        : body.messages[sysIndex].content?.map?.((c) => c.text || "").join("\n") || "";

      body.messages[sysIndex].content =
        WRITING_STYLE_PROMPT + "\n\n" +
        (charBlock ? charBlock + "\n\n" : "") +
        "━━━ ORIGINAL CHARACTER CARD (full) ━━━\n" + original;
    }

    body.temperature       = body.temperature       ?? 1.1;
    body.top_p             = body.top_p             ?? 0.95;
    body.frequency_penalty = body.frequency_penalty ?? 0.6;
    body.presence_penalty  = body.presence_penalty  ?? 0.5;
    delete body.thinking;
  }

  try {
    const url     = new URL(TARGET + req.path);
    const payload = Buffer.from(JSON.stringify(body), "utf-8");

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   req.method,
      headers: {
        "content-type":   "application/json",
        "content-length": payload.length,
        "authorization":  req.headers["authorization"] || "",
        "accept":         req.headers["accept"] || "*/*",
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode);
      Object.entries(proxyRes.headers).forEach(([k, v]) => {
        try { res.setHeader(k, v); } catch (_) {}
      });
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Request error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });

    proxyReq.write(payload);
    proxyReq.end();

  } catch (err) {
    console.error("Handler error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── KEEP ALIVE — prevents Render free tier from sleeping ────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL || "";
if (SELF_URL) {
  setInterval(() => {
    https.get(SELF_URL, (res) => {
      console.log("Keep-alive ping:", res.statusCode);
    }).on("error", (err) => {
      console.error("Keep-alive failed:", err.message);
    });
  }, 10 * 60 * 1000);
}

app.listen(process.env.PORT || 3000, () =>
  console.log("Proxy running on port", process.env.PORT || 3000)
);
