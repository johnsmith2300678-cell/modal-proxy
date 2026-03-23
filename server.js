const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const app = express();

// Set to true to enable GLM thinking mode (deeper reasoning before responding)
const ENABLE_THINKING = true;

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
      },
    },
  })
);
app.listen(process.env.PORT || 3000, () => console.log("Proxy running"));
