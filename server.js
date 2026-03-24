const express = require("express");
const https = require("https");

const app = express();

const TARGET_HOST = "api.us-west-2.modal.direct";
const ENABLE_THINKING = true;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: "10mb" }));

app.use((req, res) => {
  let outBody = "";

  if ((req.method === "POST" || req.method === "PATCH") && req.body) {
    const data = req.body;

    // Force streaming to bypass Render 30s timeout
    data.stream = true;

    // Thinking mode
    if (ENABLE_THINKING) {
      data.thinking = true;
      data.enable_thinking = true;
      if (data.temperature == null) data.temperature = 0.9;
      if (data.top_p == null) data.top_p = 0.95;
      if (data.repetition_penalty == null) data.repetition_penalty = 1.05;
    }

    outBody = JSON.stringify(data);
  }

  const outBuffer = Buffer.from(outBody, "utf8");

  const headers = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (key === "host") continue;
    headers[key] = val;
  }
  headers["host"] = TARGET_HOST;
  if (outBody) {
    headers["content-type"] = "application/json";
    headers["content-length"] = outBuffer.length;
  }

  const proxyReq = https.request(
    {
      hostname: TARGET_HOST,
      port: 443,
      path: req.url,
      method: req.method,
      headers,
      timeout: 120000,
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode);
      for (const [key, val] of Object.entries(proxyRes.headers)) {
        try { res.setHeader(key, val); } catch (_) {}
      }
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ error: "Proxy timeout" });
  });

  proxyReq.on("error", (err) => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
  });

  if (outBuffer.length > 0) proxyReq.write(outBuffer);
  proxyReq.end();
});

app.listen(process.env.PORT || 3000, () => console.log("Proxy running"));
