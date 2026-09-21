# GSM2SIP Gateway Server

This directory contains the browser-facing web app and the HTTPS server needed to serve it to a browser.

Developed by Ibrahim Abas.

## Quick start

1. Copy `.env.example` to `.env` and set your values.
2. Install dependencies:

```bash
cd server
npm install
```

3. Start the server:

```bash
npm start
```

If `npm start` reports `Cannot find module 'express'`, install the declared
dependencies first:

```bash
npm install
```

The source and configuration templates remain complete without this install;
the packages are only needed to execute the Node server locally.

4. Open the browser at:

```text
https://localhost:3000
```

If you do not yet have a TLS certificate, the app will fall back to plain HTTP on port 3000 for local testing.

For a VPS deployment with coturn, Asterisk WSS, TLS, firewall rules, and
systemd, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Required runtime settings

Set the following values in `.env` before deployment:

- `SIP_DOMAIN`
- `SIP_USERNAME`
- `SIP_PASSWORD`
- `SIP_WS_URL`
- `PORT`

Optional browser media settings are `STUN_SERVER_URLS`, `TURN_SERVER_URLS`,
`TURN_USERNAME`, and `TURN_PASSWORD`. URLs are comma-separated. TURN is strongly
recommended when browsers may connect from restrictive mobile or corporate
networks.

For browser audio, the page must be opened from HTTPS (or localhost during
development). Asterisk must expose its WSS endpoint and have a trusted DTLS
certificate for production browsers.

## Asterisk integration notes

The project is designed to talk to Asterisk over WebSocket/SIP WebRTC. The sample conf files are located in:

- `server/asterisk/pjsip.conf.example`
- `server/asterisk/extensions.conf.example`

The PJSIP template is recommended for current Asterisk releases. The outbound
dialplan uses a pre-dial handler so `X-GSM-Forward` is added to the actual
gateway channel before the INVITE is sent. The older
`sip.conf.example` is retained only for installations that still use
`chan_sip`.

These files are intentionally templates for the actual production deployment and should be adapted to your Asterisk installation.

## Browser flow

The browser web app:

- captures the user microphone,
- creates a SIP register with the Asterisk server,
- dials the target number via SIP,
- bridges WebRTC media with the Android gateway,
- exposes mute / hang up controls.

The Android gateway part is already implemented separately and handles the actual cellular call leg via GSM/SIM.

## Security recommendations

- Always serve over HTTPS in production.
- Use WSS for browser SIP signaling.
- Keep SIP credentials private.
- Restrict inbound access to your server and Asterisk host by firewall.
- Use a dedicated domain and TLS certificate.
