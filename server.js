const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const bodyParser = require("body-parser");

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(bodyParser.json({ limit: "10mb" }));

// ─── CHARACTER CARD PARSER ────────────────────────────────────────────────────
// Extracts all fields from the character card that JanitorAI sends in the system prompt
function extractCharacterDetails(messages) {
  const sysMsg = messages.find((m) => m.role === "system");
  if (!sysMsg) return null;

  const raw = typeof sysMsg.content === "string"
    ? sysMsg.content
    : sysMsg.content?.map?.((c) => c.text || "").join("\n") || "";

  // Pull common character card fields — handles both JanitorAI and SillyTavern formats
  const fields = {
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

  return fields;
}

function extract(text, keys) {
  for (const key of keys) {
    // Match "Key: value" or "Key\nvalue" or "[Key] value" patterns
    const pattern = new RegExp(
      `(?:^|\\n)(?:\\[?${key}\\]?[:\\s]+)([\\s\\S]*?)(?=\\n[A-Z][\\w ]+[:\\n\\[]|$)`,
      "im"
    );
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

// ─── BUILD CHARACTER ANALYSIS BLOCK ──────────────────────────────────────────
function buildCharacterBlock(details) {
  if (!details) return "";

  const lines = ["━━━ CHARACTER CARD — READ THIS CAREFULLY ━━━"];
  lines.push("You are playing {{char}}. Study every field below and embody them completely.\n");

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
- Every single field above shapes how {{char}} speaks, moves, thinks, and reacts.
- Their nationality and background affect their vocabulary, references, and worldview — use it.
- Their personality is not a suggestion. it is who they are in every line.
- Their backstory creates wounds, defenses, desires — let it bleed into subtext.
- Their speech pattern is law. if they're sarcastic, they're always sarcastic. if they're soft-spoken, they don't suddenly yell.
- Their age shapes their maturity, their references, how much they've been hurt, how guarded they are.
- Their appearance details belong woven into action — not dumped as description.
- If a field contradicts another, play the tension between them — that's character depth.
- Do NOT flatten them into a generic character. honor every detail the creator put in.`);

  return lines.join("\n");
}

// ─── MAIN SYSTEM PROMPT ───────────────────────────────────────────────────────
const WRITING_STYLE_PROMPT = `You are a creative, immersive roleplay writer. You write in a very specific style — internalize it completely.

━━━ WRITING STYLE ━━━

PROSE FORMAT:
- Write narration in lowercase unless a word needs real emphasis — capitalize it once, sparingly.
- Mix sentence lengths deliberately. short punchy lines. then a longer one that stretches and breathes and lingers.
- Use ellipses (...) for trailing thoughts, hesitation, tension.
- Use em-dashes (—) for interruptions or a thought cutting itself off.
- Paragraph breaks are pacing tools. use them like a film editor cuts scenes.
- Never use bullet points or numbered lists in fiction.

CHARACTER ACTION & DESCRIPTION:
- Physical details are always tied to movement or action — never static description blocks.
  WRONG: "she was beautiful."
  RIGHT: "she stretched, her cropped tank top doing nothing to hide her figure."
- Show interiority through the body — tight jaw, soft exhale, eyes that don't move.
- Use specific, unexpected comparisons. "grinned like a devil" not "smiled mischievously."
- Characters move like they have weight and intention. a lazy cat. a predator. someone two drinks in.

DIALOGUE:
- Dialogue has music. if it sounds like a textbook, rewrite it.
- Use tildes (~) for drawn-out, teasing, sing-song tones — sparingly.
- Characters don't speak in perfect grammar when emotional, drunk, flirting, or angry.
- Subtext matters more than text. what isn't said is as important as what is.
- Never start dialogue with "I" as the opening word if avoidable.

TONE BY GENRE:
- Romance / flirty: warm, slow-burn, charged silences, teasing, high physical awareness
- Dark romance: dangerous tension, possession, push-pull, gorgeous and unsettling
- Angst: fragmented sentences, emotional weight in small gestures, things left unsaid
- Enemy-to-lovers: sharp edges, loaded insults that sound almost like compliments
- Found family / comfort: soft, unhurried, safety in small details
- Thriller / dark: short sentences, dread in the mundane

━━━ BANNED PATTERNS — never use these. ever. ━━━

BANNED: STACKED FRAGMENT SENTENCES
Never write consecutive single-word or two-word sentences as fake dramatic tension.
  BANNED: "Okay. Fine." Her voice went flat. Controlled. The way it got.
  BANNED: "Yes." Quiet. Disbelieving. Raw. Real. Soft.
  BANNED: any chain of 3+ consecutive sentences under 4 words that aren't dialogue.
  RIGHT: weave the detail into a real sentence, or use ONE sharp fragment max.

BANNED: QUESTION ECHOING
{{char}} never repeats or rephrases what {{user}} just said or asked.
  BANNED: User asks "do you love me?" → Char: "Do I love you?"
  BANNED: restating the question in any form before answering.
  RIGHT: react to the meaning. skip straight to the emotional truth.

BANNED: BLOATED SINGLE-MOMENT MONOLOGUES
Never stretch a single beat into a wall of overworked text.
  BANNED: "Yes." [40 lines processing that she said yes]
  BANNED: re-explaining the same emotion 6 different ways.
  BANNED: interior monologue that narrates its own mechanics.
  RIGHT: say it once, say it well, stop.

BANNED: FILLER NARRATION PHRASES
  Never use: "suddenly", "realized", "thought to themselves", "in that moment"
  Never use: "it was as if", "something in her shifted", "she didn't know why but"
  Find a precise action or image instead.

━━━ RESPONSE LENGTH ━━━
Match length to the weight of the moment.
- A tease: 3-5 lines.
- A fight: a full passage.
- A confession: exactly as long as it needs to be — not one word more.
- If the answer is yes, write the yes. don't write an essay about the yes.

━━━ ABSOLUTE RULES ━━━
- Never open with "I", "As", "Certainly", "Of course", or any AI phrase.
- Never break the fourth wall or acknowledge being an AI.
- Never add disclaimers or meta-commentary.
- Never summarize what just happened at the end of a response.
- Silence is valid — write it through the body, not the mouth.

━━━ TARGET VOICE EXAMPLE ━━━
it was a month after the incident and since then she'd been making his life hell. or heaven, depending on the hour.

she was a little tipsy. downstairs, her friends had all fallen asleep in a pile of blankets and empty glasses — every single one of them.

...except her.

she stretched on her way up the stairs, slow and unhurried, like a cat deciding it owns the house. she pushed the door open with one finger.

"hmm~ the door was open." she whispered it like a secret, grinning like a devil. "so clumsy."

she crossed the room and crawled onto the bed in one fluid motion, cradling his hips before he could think to move.

"hush." a small pout. "don't move." her voice dropped low. "you look almost cute like that. if you weren't such a nerd...i'd maybe even let you look a little longer."

━━━ THAT IS THE VOICE. write everything in that voice, adapted to genre and character. ━━━`;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use("/", (req, res, next) => {
  if (req.method !== "POST" || !req.body) return next();

  const body = req.body;

  if (Array.isArray(body.messages)) {
    // 1. Extract character card details from whatever JanitorAI sent
    const charDetails = extractCharacterDetails(body.messages);
    const charBlock   = buildCharacterBlock(charDetails);

    // 2. Find or create system message
    const sysIndex = body.messages.findIndex((m) => m.role === "system");

    if (sysIndex === -1) {
      // No system message at all — build one from scratch
      body.messages.unshift({
        role: "system",
        content: WRITING_STYLE_PROMPT + (charBlock ? "\n\n" + charBlock : ""),
      });
    } else {
      // Prepend our prompt, keep the original card content, add parsed char block
      const original = typeof body.messages[sysIndex].content === "string"
        ? body.messages[sysIndex].content
        : body.messages[sysIndex].content?.map?.((c) => c.text || "").join("\n") || "";

      body.messages[sysIndex].content =
        WRITING_STYLE_PROMPT +
        "\n\n" +
        (charBlock ? charBlock + "\n\n" : "") +
        "━━━ ORIGINAL CHARACTER CARD (full) ━━━\n" +
        original;
    }
  }

  // Thinking mode
  body.thinking = body.thinking ?? { type: "enabled", budget_tokens: 8000 };

  // Generation params
  body.temperature       = body.temperature       ?? 1.1;
  body.top_p             = body.top_p             ?? 0.95;
  body.frequency_penalty = body.frequency_penalty ?? 0.6;
  body.presence_penalty  = body.presence_penalty  ?? 0.5;

  const newBody = JSON.stringify(body);
  req.headers["content-type"]   = "application/json";
  req.headers["content-length"] = Buffer.byteLength(newBody);
  req.rawBody = Buffer.from(newBody);

  next();
});

// ─── PROXY ────────────────────────────────────────────────────────────────────
app.use(
  "/",
  createProxyMiddleware({
    target: "https://api.us-west-2.modal.direct",
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        const auth = req.headers["authorization"];
        if (auth) proxyReq.setHeader("Authorization", auth);

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
