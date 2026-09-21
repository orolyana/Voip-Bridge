<p align="center">
  <img src="icon.png" width="128" alt="GSM2SIP Gateway">
</p>

<h1 align="center">GSM2SIP Gateway</h1>

<p align="center">
Bridges Android phone to any SIP server as GSM Gateway
</p>

| Calls | Link detail | Settings |
|--------|-----------------|----------|
| <img src="screen1.png" width="300"> | <img src="screen2.png" width="300"> | <img src="screen3.png" width="300"> |

## How It Works

A dedicated rooted Android phone with a local SIM card acts as a SIP-to-GSM gateway:

- **Inbound**: Someone calls the SIM's number → the phone answers → the call is bridged to the SIP server, which routes it wherever the dialplan says (an AI agent, a queue, an extension)
- **Outbound**: the SIP server sends an INVITE with an `X-GSM-Forward: +<number>` header → the phone dials that number over GSM → audio is bridged back to SIP
Audio flows through shared speaker/mic — both GSM and SIP audio run concurrently on the same hardware, enabled by a Magisk module that disables Android's audio concurrency restrictions.

## Audio Codec

Selectable in Settings, defaulting to **G.722 only** (wideband, 16 kHz):

| Setting | Offered in SDP |
|---|---|
| G.722 only *(default)* | `9` |
| G.722 preferred, G.711 allowed | `9 8 0` |
| G.711 only | `8 0` |

The default is G.722 alone because offering G.711 alongside it means servers
routinely pick G.711 and every call ends up narrowband regardless of what both
ends support.  Whatever is configured, the app still answers with a codec the
remote actually offered rather than failing a call over a preference.

## Supported Devices

| Device | SoC | Agent → caller | Caller → agent | Status |
|---|---|---|---|---|
| Xiaomi Poco X3 NFC (`surya`) | Qualcomm SM6150/SM7150, WCD9375 | digital, via `incall_music` → `Telephony Tx` | digital, via `VOICE_DOWNLINK` | **fully working** |
| Samsung Galaxy S4 Mini (`serranolte`) | Qualcomm MSM8960, WCD9304 | digital, via `incall_music` | digital, via `VOC_REC_*` | **fully working** |
| Samsung Galaxy S10e | Exynos 9820, CS47L93 | no path | no path | not usable |

**The Poco X3 NFC is the reference device and works fully**: G.722 wideband in
both directions, entirely through the modem, with the handset's own microphone
and speaker muted for the whole call.

**The Galaxy S4 Mini works fully too**, which is worth dwelling on because it
is a 2013 handset on LineageOS 16 (Android 9) and armeabi-v7a — and because its
own vendor configuration claims it cannot.  Its
`audio_policy_configuration.xml` declares no `incall_music_uplink` mixPort and
no Telephony Tx device, and `mixer_paths.xml` has no incall-music path at all,
yet the kernel exposes `Incall_Music Audio Mixer MultiMedia1/2` and
`MultiMedia1 Mixer VOC_REC_DL/UL` regardless.

### Choosing a device

Support is a property of the **vendor image, not the chip**.  Everything the
SM6150 profile relies on — the `incall_music` mixer, the `VOC_REC_*` capture
routing, the `voice_extn` `vsid`/`call_state` interface — is generic Qualcomm
audio, present across the msm8974→sm8xxx HAL family. 

Check a candidate :

```bash
tools/check-device.sh [adb-serial]
```

The audio-policy check needs no root, so a phone can be vetted before rooting
it.  The HAL and mixer checks need Magisk with Superuser access set to
"Apps and ADB".

What has actually been checked so far:

| Device | SoC | Vendor | Result |
|---|---|---|---|
| Poco X3 NFC | SM6150/SM7150 | Xiaomi (MIUI) | fully working, verified on live calls |
| Galaxy S4 Mini | MSM8960 | LineageOS 16 | fully working, verified on a live call |
| Galaxy S10e | Exynos 9820 | — | no path in either direction |

Everything the working profile depends on is generic Qualcomm audio, so other
Qualcomm phones are plausible candidates — but the deciding factors live in the
vendor image, which is exactly what the script above inspects.  A new device
still needs a `DeviceProfile` entry: the mixer names are generic, the front-end
the playback track lands on is not, and the `Mixer BEFORE/AFTER` lines logged
around each call show which one it is.  An unrecognised Qualcomm device falls
back to `genericQualcomm()`.

Getting digital capture on a Qualcomm device depends on one thing that is easy
to miss.  The HAL gates in-call recording — and the per-session voice mutes —
on `voice_is_call_state_active()`, and on LineageOS that flag is never set:

```
voice_extn: update_call_states is_call_active:0 in_call:1, mode:2
```

`MODE_IN_CALL` is set and the modem's voice session is running, yet every VSID
stays `CALL_INACTIVE`, so `VOICE_CALL`, `VOICE_DOWNLINK` and the `VOC_REC_*`
mixers all return silence.  The app announces the call itself
(`vsid=<hex>;call_state=2`) before opening `AudioRecord`.

The Exynos S10e has no equivalent, and this was confirmed on the hardware
rather than inferred: `audio_policy_configuration.xml` declares three mixPorts
(`deep`, `fast`, `primary`) and no telephony device, and
`audio.primary.universal9820.so` contains no `TELEPHONY_TX`, no `incall_rec`
usecases and no `voice_extn` `call_state`/`vsid` handling.  There is nothing to
inject into and nothing to capture from, so neither direction can be digital.
That is why the gateway moved to a Qualcomm device.

## Requirements

- **Device**: Qualcomm-based Android phone with LineageOS + Magisk root
  (developed against a Poco X3 NFC on Android 16)
- **SIM**: SIM card with voice plan
- **Network**: Stable WiFi connection
- **Power**: Always connected to charger
- **Build host**: Linux with JDK 17+

## Download

Prebuilt APK and Magisk module are available from the project's releases.

Install the Magisk module — it carries the APK as a privileged system app.
Building from source is only needed to change something; see below.

## Build

```bash
chmod +x build.sh
./build.sh          # debug build
./build.sh release  # release build
```

Outputs:
- `gateway-magisk.zip` — Magisk module containing the APK, permissions, and audio tools (tinymix, tinycap). This is the only file you need to install.

The APK itself is architecture-independent, but `tinymix` is not: the ALSA
control ioctls encode the size of structs containing `long`, so an arm64 build
and an armeabi-v7a build speak different ioctl ABIs and neither works on the
other's kernel.  The module ships both and `install.sh` picks the matching one
at flash time.  Getting this wrong fails quietly rather than loudly — the wrong
binary is still marked executable, so it looks present while every mixer
command dies with `not executable: 64-bit ELF file`.

## Device Setup

Only the Magisk module needs to be installed — it includes the APK and handles all permissions automatically.

1. **Install Magisk module**: Copy `gateway-magisk.zip` to device, install via Magisk Manager → Modules
2. **Reboot** the device — the module installs the APK as a privileged system app and grants all permissions on boot
3. **Set as default phone app**: Settings → Apps → Default apps → Phone app → web2phone
4. **Configure SIP**: open Settings in the app (the gear, top right) and enter
   your SIP server address, port, username and password
5. **Own Number**: Enter the SIM's own number in international format, e.g.
   `+4915112345678`.  This is sent as the SIP destination so the server can
   route on the number that was dialled, the same way a VoIP router sends the
   DID.  Leaving it unset makes the gateway address its own extension,
   which most servers route straight back to the device — the call then loops
   and the GSM leg is never answered.
6. **Start**: the gateway registers and begins bridging calls; the header pill
   shows **Online** once registration succeeds (tap it to retry)

### What the SIP leg carries

- **Request-URI / To** — the number that was dialled, i.e. the gateway SIM's
  MSISDN.  Not the SIP account name.
- **From** — the calling party, passed through exactly as the carrier delivered
  it (some send `+49…`, some `0…`; the app does not rewrite it).

Whatever the server routes on, it has to recognise the SIM's number: the
gateway puts that number in the Request-URI, so a dialplan or number table
keyed on it is what decides where the call goes.

## The longer way: your own Asterisk

The gateway is server-agnostic — it registers like any SIP client — so you can
point it at a server you run instead. What follows is one worked example,
using Asterisk (chan_sip) to route inbound GSM calls to an AI agent. Adapt it
to whatever your server does.

It addresses calls the way a VoIP router does: the Request-URI carries the
SIM's number and `From` carries the calling party. That shapes the config
below in two ways — the extension to match is the SIM's MSISDN in E.164, so
the pattern has to accept the leading `+`, and the From user is no longer the
account name, so the peer has to be recognised by the address it registered
from rather than by who the INVITE says it is.

### 1. Create a SIP account for the gateway

Add to `sip.conf` or create via the realtime database:

```ini
[gateway-gw1](agent-template)
type = friend
host = dynamic
secret = <strong-password>
context = gateway-incoming
; From carries the GSM caller, not "gateway-gw1".  If chan_sip then logs "no
; matching peer" for the caller's number, this makes it match on the address
; the gateway registered from instead.
insecure = port,invite
; The gateway offers G.722 only unless Settings → Codec says otherwise.
disallow = all
allow = g722
```

### 2. Add gateway dialplan context

Add to `extensions.conf`:

```ini
; Gateway incoming calls (GSM → SIP → Agent)
; EXTEN is the SIM's own number in international format, e.g. +4915112345678
; — the leading "+" is why this is _+X. and not _X.
[gateway-incoming]
exten => _+X.,1,NoOp(GSM call for ${EXTEN} from ${CALLERID(num)})
same => n,Set(CDR(destination)=${EXTEN})
same => n,Set(CDR(userfield)=gateway-gw1)
; Route on the number that was dialled, the way a DID is routed — one server,
; several gateway SIMs, each landing on its own agent.
same => n,Set(AgentToUse=${ODBC_AGENT_LOOKUP(${EXTEN})})
same => n,GotoIf($["${AgentToUse}" = ""]?default_agent:route_to_agent)
same => n(route_to_agent),MixMonitor(/var/spool/asterisk/monitor/${STRFTIME(${EPOCH},,%Y%m%d-%H%M%S)}-${UNIQUEID}.wav)
same => n,Dial(SIP/${AgentToUse},60,tT)
same => n,Hangup()
same => n(default_agent),MixMonitor(/var/spool/asterisk/monitor/${STRFTIME(${EPOCH},,%Y%m%d-%H%M%S)}-${UNIQUEID}.wav)
same => n,Dial(SIP/100,60,tT)
same => n,Hangup()
```

Developed by Ibrahim Abas.

`${CALLERID(num)}` is the GSM caller, passed through as the carrier delivered
it — some carriers send `+49…`, some `0…`, and the gateway rewrites neither.
Normalise it before any lookup that keys on the caller.

### 3. Making outbound calls through the gateway

Address the call the same way you would address a message: put the number in
the Request-URI and dial the peer.

```ini
exten => _X.,1,NoOp(Outbound via GSM gateway: ${EXTEN})
same => n,Dial(SIP/gateway-gw1/${EXTEN},60)
same => n,Hangup()
```

`X-GSM-Forward` does the same job and takes precedence where both are present,
which is what a dialplan needs when the number it dials is not the number it
wants called:

```ini
same => n,SIPAddHeader(X-GSM-Forward: ${EXTEN})
same => n,Dial(SIP/gateway-gw1,60)
```

The user part of the Request-URI is only read as a destination when it is one:
the account name and the SIM's own number are both ignored, since dialling
either would be a loop, and so is anything that is not a bare number. Under
`chan_pjsip`, note that `SIPAddHeader()` is silently a no-op — the header form
there is `Set(PJSIP_HEADER(add,X-GSM-Forward)=${EXTEN})`.

Allow enough time in `Dial()` for GSM setup — 60s is comfortable, 20s is not.

## Call status codes

What the gateway answers with is a property of the gateway, not of any one
server, so this holds whichever server you point it at. It reports progress
and failure the way a provider does — on Asterisk that means the dialplan can
branch on `${DIALSTATUS}` and `${HANGUPCAUSE}` instead of guessing.

### Outbound — the server asks the gateway to dial

| Situation | Response |
| --- | --- |
| INVITE received | `100 Trying` |
| Dialling the SIM | `180 Ringing` |
| The mobile answered | `200 OK`, then RTP |
| Callee busy | `486 Busy Here` |
| Callee declined | `603 Decline` |
| No answer, or unreachable | `480 Temporarily Unavailable` |
| Cancelled at the handset | `487 Request Terminated` |
| Number barred | `403 Forbidden` |
| Gateway already on a call | `486 Busy Here` |
| No destination in the INVITE | `488 Not Acceptable Here` |
| Anything failing after the answer | `BYE` |

The `180` carries no SDP, deliberately. Without an SDP answer the server
cannot open an early-media path, so an agent cannot be bridged into a call the
mobile has not picked up yet — if you ever hear the agent start talking before
you answer, something other than this gateway put it there. `183 Session
Progress` is never sent for that reason.

A `488` means the INVITE named no number the gateway could dial — neither an
`X-GSM-Forward` header nor a usable Request-URI. Under `chan_sip` that usually
means `SIPAddHeader()` ran on a different channel than the one that was
dialled; under `chan_pjsip` it means `SIPAddHeader()` ran at all.

Only a call the gateway answered is ended with `BYE`. One that never connected
is turned down with the final response above, which is the only place the
server learns why the GSM leg did not come up — a `BYE` for an unanswered
INVITE is not valid, and a server that gets one replies `481` and then sits
out its own timer, which makes every failure look alike and look like a
timeout.

### Inbound — the SIM rings and the gateway calls the server

Here the gateway is the caller, so these are the responses it acts on. It
places the INVITE while the GSM leg is still ringing and answers the GSM call
only once the server sends `200 OK`, so the caller hears normal ringing until
the agent is actually on the line, with no dead air at the join.

| Server sends | Gateway does |
| --- | --- |
| `100` / `180` / `183` | Keeps the GSM leg ringing |
| `200 OK` | Answers the GSM call and starts the bridge |
| `486` / `603` / any 4xx-6xx | Ends the GSM call |
| No response | Retries, then gives up and ends the GSM call |

## Architecture

```
┌─────────────────┐     GSM      ┌──────────────────┐
│  Remote Caller   │◄───────────►│  Android Phone    │
│  (local #)       │   voice     │  (Poco X3 + SIM)  │
└─────────────────┘              │                    │
                                 │  ┌──────────────┐ │
                                 │  │ InCallService │ │  GSM call control
                                 │  └──────┬───────┘ │
                                 │         │         │
                                 │  ┌──────▼───────┐ │
                                 │  │ Orchestrator  │ │  Bridges GSM ↔ SIP
                                 │  └──────┬───────┘ │
                                 │         │         │
                                 │  ┌──────▼───────┐ │
                                 │  │  SIP Client   │ │  Registration + calls
                                 │  │  RTP Session  │ │  G.722 audio stream
                                 │  └──────┬───────┘ │
                                 └─────────┼─────────┘
                                           │ SIP/RTP
                                           │ (WiFi)
                                 ┌─────────▼─────────┐
                                 │    SIP Server      │
                                 │  (Asterisk, etc.)  │
                                 └─────────┬─────────┘
                                           │
                                 ┌─────────▼─────────┐
                                 │ Agent / queue /   │
                                 │ extension         │
                                 └───────────────────┘
```

## Magisk Module

The `gateway-magisk.zip` module does two critical things:

1. **Disables audio concurrency restrictions** (`system.prop`):
   - `voice.voip.conc.disabled=false` — allows VoIP audio during GSM calls
   - `voice.record.conc.disabled=false` — allows audio recording during calls
   - `voice.playback.conc.disabled=false` — allows audio playback during calls

2. **Grants system-level permissions** (`privapp-permissions-gateway.xml`):
   - `CAPTURE_AUDIO_OUTPUT` — capture audio from other sources
   - `MODIFY_PHONE_STATE` — control telephony
   - `READ_PRECISE_PHONE_STATE` — detailed call state info

## Troubleshooting

- **Agent hears silence**: the foreground service must be started while an
  Activity is visible. Android 12+ withholds `PROCESS_CAPABILITY_FOREGROUND_MICROPHONE`
  from a service started in the background, and AudioPolicy then feeds
  `AudioRecord` zeros without any error (`rec update ... silenced` in
  `dumpsys audio`). The module launches the UI on boot for this reason.
- **Agent hears itself / heavy noise**: capture must use `VOICE_DOWNLINK`, not
  `VOICE_CALL`. The latter mixes uplink and downlink, and the uplink carries
  the injected agent audio.
- **Caller hears the room or their own echo**: the phone's mic is in the GSM
  uplink. Muting it only works through `AudioManager` — the ALSA voice mutes
  are rewritten by the HAL, and they are 3-element arrays
  (`{mute, session_vsid, ramp_ms}`), so a single-value `tinymix` write silently
  does nothing.
- **Calls loop back and never answer**: the Own Number setting is unset, so the
  gateway is INVITEing its own extension.
- **One-way audio**: Ensure the Magisk module is installed and device is rebooted
- **Echo**: The app uses Android's AcousticEchoCanceler + VOICE_COMMUNICATION mode
- **SIP not registering**: Check WiFi connectivity, server address, and credentials
- **Calls not auto-answering**: Ensure the app is set as the default phone app
- **Audio drops**: Check WiFi stability; the app holds a WiFi lock but poor signal will cause issues
