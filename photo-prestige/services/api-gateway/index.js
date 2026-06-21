require("dotenv").config();
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const jwt = require("jsonwebtoken");

const app = express();

app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing token" });

  const token = header.split(" ")[1];

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: "Invalid token" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user?.role) return res.status(403).json({ error: "No role" });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

app.use(
  "/auth",
  createProxyMiddleware({
    target: "http://auth-service:3001",
    changeOrigin: true,
    pathRewrite: { "^/auth": "" }
  })
);

app.use(
  "/register",
  createProxyMiddleware({
    target: "http://register-service:3002",
    changeOrigin: true
  })
);

app.use(
  "/register/photo",
  authenticate,
  createProxyMiddleware({
    target: "http://register-service:3002",
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader("x-user-id", req.user.userId);
        proxyReq.setHeader("x-user-role", req.user.role);
      }
    }
  })
);

app.use(
  "/targets",
  authenticate,
  createProxyMiddleware({
    target: "http://target-service:3003",
    changeOrigin: true,
    pathRewrite: { "^/targets": "" },
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader("x-user-id", req.user.userId);
        proxyReq.setHeader("x-user-role", req.user.role);
      }
    }
  })
);

app.use(
  "/scores",
  authenticate,
  createProxyMiddleware({
    target: "http://score-service:3006",
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader("x-user-id", req.user.userId);
        proxyReq.setHeader("x-user-role", req.user.role);
      }
    }
  })
);

app.listen(3080);