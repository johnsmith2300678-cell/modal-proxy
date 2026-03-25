const express = require("express");
const { createProxyMiddleware, fixRequestBody } = require("http-proxy-middleware");
const app = express();

const ENABLE_THINKING = true;

app.use(express.json());

app.use((req, res, next) => {
  if (req.body) {
    req.body.stream = true;
    if (ENABLE_THINKING) {
      req.body.thinking = true;
      req.body.enable_thinking = true;
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
