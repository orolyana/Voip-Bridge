const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.WEB_HOST || '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const webRoot = path.join(__dirname, '../web');
const sipDomain = process.env.SIP_DOMAIN || '';
const sipWsUrl = process.env.SIP_WS_URL || '';
const sipUsername = process.env.SIP_USERNAME || '';
const sipPassword = process.env.SIP_PASSWORD || '';
const stunServerUrls = (process.env.STUN_SERVER_URLS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const turnServerUrls = (process.env.TURN_SERVER_URLS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const iceServers = [
  ...stunServerUrls.map((urls) => ({ urls })),
  ...(turnServerUrls.length > 0
    ? [{
        urls: turnServerUrls,
        username: process.env.TURN_USERNAME || '',
        credential: process.env.TURN_PASSWORD || ''
      }]
    : [])
];

function requestProtocol(req) {
  return String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function runtimeSipConfiguration(req) {
  const domain = sipDomain || req.hostname;
  const wsProtocol = requestProtocol(req) === 'https' ? 'wss' : 'ws';
  const wsUrl = sipWsUrl || `${wsProtocol}://${domain}:8089/ws`;
  return { domain, wsUrl };
}

function sipConfigurationError(req) {
  const runtimeSip = runtimeSipConfiguration(req);
  const missing = [];
  if (!runtimeSip.domain) missing.push('SIP_DOMAIN');
  if (!runtimeSip.wsUrl) missing.push('SIP_WS_URL');
  if (!sipUsername) missing.push('SIP_USERNAME');
  if (!sipPassword) missing.push('SIP_PASSWORD');
  if (missing.length === 0) return null;
  return `Missing SIP configuration: ${missing.join(', ')}`;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; media-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'"
  );
  next();
});

app.get('/api/health', (req, res) => {
  const runtimeSip = runtimeSipConfiguration(req);
  res.json({
    ok: true,
    service: 'gsm2sip gateway server',
    mode: isProd ? 'production' : 'development',
    timestamp: new Date().toISOString(),
    configured: !sipConfigurationError(req),
    sip: {
      domain: runtimeSip.domain || null,
      wsUrl: runtimeSip.wsUrl || null
    }
  });
});

app.get('/api/config', (req, res) => {
  const runtimeSip = runtimeSipConfiguration(req);
  const configurationError = sipConfigurationError(req);
  if (configurationError) {
    return res.status(503).json({ ok: false, error: configurationError });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    sip: {
      domain: runtimeSip.domain,
      wsUrl: runtimeSip.wsUrl,
      username: sipUsername,
      password: sipPassword,
      iceServers
    },
    websocket: {
      secure: true,
      path: '/ws'
    },
    app: {
      name: 'GSM2SIP Gateway',
      version: '1.0.0'
    }
  });
});

app.get('/api/settings', (req, res) => {
  const runtimeSip = runtimeSipConfiguration(req);
  const configurationError = sipConfigurationError(req);
  const asteriskUrl = new URL(runtimeSip.wsUrl || 'ws://localhost:8089/ws');

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    server: {
      environment: isProd ? 'production' : 'development',
      host: req.hostname,
      protocol: requestProtocol(req),
      port
    },
    sip: {
      domain: runtimeSip.domain || null,
      username: sipUsername || null,
      configured: !configurationError
    },
    asterisk: {
      host: asteriskUrl.hostname,
      port: Number(asteriskUrl.port || (asteriskUrl.protocol === 'wss:' ? 443 : 80)),
      websocketUrl: runtimeSip.wsUrl || null,
      configured: Boolean(runtimeSip.wsUrl),
      note: 'Asterisk availability is confirmed when SIP registration succeeds.'
    },
    media: {
      stunServers: stunServerUrls,
      turnConfigured: turnServerUrls.length > 0
    }
  });
});

app.get('/api/ready', (req, res) => {
  const configurationError = sipConfigurationError(req);
  if (configurationError) {
    return res.status(503).json({ ready: false, error: configurationError });
  }
  res.json({ ready: true, message: 'Gateway server is ready.' });
});

app.use(express.static(webRoot));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(webRoot, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).json({ ok: false, error: 'Web client not found' });
});

const sslKeyPath = process.env.HTTPS_KEY_PATH || path.join(__dirname, 'certs', 'server.key');
const sslCertPath = process.env.HTTPS_CERT_PATH || path.join(__dirname, 'certs', 'server.crt');

let server;
if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  const httpsOptions = {
    key: fs.readFileSync(sslKeyPath),
    cert: fs.readFileSync(sslCertPath)
  };
  server = https.createServer(httpsOptions, app);
  console.log(`HTTPS server listening on https://${host}:${port}`);
} else {
  server = require('http').createServer(app);
  console.log(`HTTP server listening on http://${host}:${port}`);
  console.log('HTTPS certs not found. Add certs/server.key and certs/server.crt for production TLS.');
}

server.listen(port, host, () => {
  console.log(`GSM2SIP gateway is running on ${host}:${port}`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => process.exit(0));
});
