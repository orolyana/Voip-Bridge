const state = {
  userAgent: null,
  registerer: null,
  session: null,
  muted: false,
  connected: false,
  localStream: null,
  target: null,
  log: [],
  reconnectTimer: null,
  reconnectAttempts: 0,
  reconnecting: false,
  audioContext: null,
  callingToneTimer: null,
  callStartedAt: null,
  callTimer: null
};

const AUTH_USERNAME = 'Admin';
const AUTH_PASSWORD = 'Admin';
const AUTH_STORAGE_KEY = 'web2phone-authenticated';

const config = {
  domain: '',
  wsUrl: '',
  username: '',
  password: ''
};

const numberInput = document.getElementById('number-input');
const callButton = document.getElementById('call-button');
const hangupButton = document.getElementById('hangup-button');
const muteButton = document.getElementById('mute-button');
const callStatus = document.getElementById('call-status');
const callInfo = document.getElementById('call-info');
const connectionPill = document.getElementById('connection-pill');
const logList = document.getElementById('log-list');
const remoteAudio = document.getElementById('remote-audio');
const backspaceButton = document.getElementById('backspace-button');
const loginScreen = document.getElementById('login-screen');
const dialerScreen = document.getElementById('dialer-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutButton = document.getElementById('logout-button');
const menuButton = document.getElementById('menu-button');
const utilityMenu = document.getElementById('utility-menu');
const refreshSettingsButton = document.getElementById('refresh-settings-button');
const settingsMessage = document.getElementById('settings-message');

function setCallInfo(message) {
  callInfo.textContent = message;
}

function setCallControls(active) {
  callButton.disabled = active;
  hangupButton.disabled = !active;
  muteButton.disabled = !active;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const item = document.createElement('li');
  item.textContent = `[${stamp}] ${message}`;
  logList.prepend(item);
  state.log.unshift(message);
  while (state.log.length > 20) state.log.pop();
}

function setStatus(label) {
  callStatus.textContent = label;
  callStatus.dataset.state = label.toLowerCase().replace(/\s+/g, '-');
}

function getAudioContext() {
  if (!state.audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    state.audioContext = new AudioContext();
  }
  if (state.audioContext.state === 'suspended') state.audioContext.resume();
  return state.audioContext;
}

function playTone(frequency, duration = 0.08, type = 'sine', volume = 0.035) {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

function playButtonTone(value) {
  const toneMap = { '1': 697, '2': 770, '3': 852, '4': 697, '5': 770, '6': 852, '7': 697, '8': 770, '9': 852, '*': 941, '0': 941, '#': 941, '+': 620 };
  playTone(toneMap[value] || 620, 0.07, 'sine', 0.025);
}

function stopCallingTone() {
  if (state.callingToneTimer) window.clearInterval(state.callingToneTimer);
  state.callingToneTimer = null;
}

function startCallingTone() {
  stopCallingTone();
  const ring = () => {
    playTone(440, 0.45, 'sine', 0.025);
    window.setTimeout(() => playTone(480, 0.45, 'sine', 0.025), 500);
  };
  ring();
  state.callingToneTimer = window.setInterval(ring, 3_000);
}

function startCallTimer() {
  state.callStartedAt = Date.now();
  const update = () => {
    const elapsed = Math.floor((Date.now() - state.callStartedAt) / 1000);
    const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const seconds = String(elapsed % 60).padStart(2, '0');
    setCallInfo(`Connected for ${minutes}:${seconds}`);
  };
  update();
  state.callTimer = window.setInterval(update, 1_000);
}

function stopCallTimer() {
  if (state.callTimer) window.clearInterval(state.callTimer);
  state.callTimer = null;
  state.callStartedAt = null;
}

function errorReason(error, fallback = 'Could not place the call.') {
  const response = error && error.response;
  const statusCode = error && (error.statusCode || (response && response.statusCode));
  const message = error && (error.message || error.reason || error.cause);
  if (statusCode) return `SIP server returned ${statusCode}${message ? `: ${message}` : ''}`;
  if (message) return String(message).replace(/^Error:\s*/i, '');
  return fallback;
}

function setConnectionState(online) {
  state.connected = online;
  connectionPill.textContent = online ? 'Online' : 'Offline';
  connectionPill.classList.toggle('online', online);
  connectionPill.classList.toggle('offline', !online);
}

function bindDigits() {
  document.querySelectorAll('.digit').forEach((button) => {
    button.addEventListener('click', () => {
      const current = numberInput.value;
      const value = button.dataset.value;
      if (value === '+' && current.length > 0) return;
      playButtonTone(value);
      numberInput.value = current + value;
      numberInput.focus();
      updateNumberHint();
    });
  });
}

function updateNumberHint() {
  const hasNumber = numberInput.value.length > 0;
  document.getElementById('number-hint').textContent = hasNumber
    ? `${numberInput.value.length} digit${numberInput.value.length === 1 ? '' : 's'}`
    : 'Use the keypad below';
  backspaceButton.disabled = !hasNumber;
}

function normalizeNumber(value) {
  return value.trim().replace(/[\s()-]/g, '');
}

function isDialableNumber(value) {
  return /^(?:\+?[0-9]{3,20}|[*#0-9]{2,20})$/.test(value);
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error('Runtime config request failed');
    }
    const runtime = await response.json();
    Object.assign(config, runtime.sip);
    log(`Loaded SIP settings for ${config.domain}`);
    return true;
  } catch (error) {
    log(`SIP configuration unavailable: ${error.message}`);
    return false;
  }
}

function setSetting(id, value) {
  document.getElementById(id).textContent = value || 'Not available';
}

async function loadRuntimeSettings() {
  settingsMessage.textContent = 'Detecting deployed server settings...';
  try {
    const response = await fetch('/api/settings', { cache: 'no-store' });
    if (!response.ok) throw new Error('Settings request failed');
    const settings = await response.json();
    setSetting('setting-server', `${settings.server.protocol}://${settings.server.host}:${settings.server.port}`);
    setSetting('setting-environment', settings.server.environment);
    setSetting('setting-sip-domain', settings.sip.domain);
    setSetting('setting-sip-user', settings.sip.username);
    setSetting('setting-asterisk', settings.asterisk.websocketUrl);
    setSetting('setting-media', settings.media.turnConfigured ? 'TURN enabled' : 'STUN only');
    settingsMessage.textContent = settings.sip.configured
      ? 'Loaded automatically from the running server.'
      : 'SIP credentials are incomplete on the server.';
  } catch (error) {
    settingsMessage.textContent = `Could not load settings: ${error.message}`;
  }
}

function toggleUtilityMenu() {
  const isOpen = !utilityMenu.hidden;
  utilityMenu.hidden = isOpen;
  menuButton.setAttribute('aria-expanded', String(!isOpen));
}

function ensureAudio() {
  if (state.localStream) {
    return Promise.resolve(state.localStream);
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  }).then((stream) => {
    state.localStream = stream;
    return stream;
  });
}

async function setupSip() {
  if (!window.SIP || !window.SIP.UserAgent) {
    throw new Error('sip.js failed to load. Check CDN access.');
  }

  if (!config.domain || !config.wsUrl || !config.username || !config.password) {
    throw new Error('SIP configuration is incomplete');
  }

  const uri = SIP.UserAgent.makeURI(`sip:${config.username}@${config.domain}`);
  if (!uri) {
    throw new Error('Invalid SIP user or domain');
  }

  const userAgent = new SIP.UserAgent({
    uri,
    transportOptions: {
      server: config.wsUrl
    },
    authorizationUsername: config.username,
    password: config.password,
    displayName: 'Web User',
    sessionDescriptionHandlerFactoryOptions: {
      peerConnectionConfiguration: {
        iceServers: config.iceServers || []
      },
      constraints: {
        audio: true,
        video: false
      }
    }
  });

  userAgent.delegate = {
    onInvite: async (inviteSession) => {
      log('Incoming call received');
      setStatus('Incoming call');
      try {
        await inviteSession.accept({
          sessionDescriptionHandlerOptions: {
            constraints: { audio: true, video: false }
          }
        });
        state.session = inviteSession;
        watchSession(inviteSession);
      } catch (error) {
        log(`Could not answer call: ${error.message}`);
        setStatus('Call rejected');
      }
    }
  };

  userAgent.transport.stateChange.addListener((transportState) => {
    const online = transportState === SIP.TransportState.Connected;
    setConnectionState(online);
    log(online ? 'SIP connected' : 'SIP disconnected');
    if (!online && transportState === SIP.TransportState.Disconnected) {
      scheduleSipReconnect();
    }
  });

  await userAgent.start();
  const registerer = new SIP.Registerer(userAgent);
  await registerer.register();
  state.userAgent = userAgent;
  state.registerer = registerer;
  state.reconnectAttempts = 0;
  log('SIP registration successful');
  return userAgent;
}

function scheduleSipReconnect() {
  if (state.reconnectTimer || state.reconnecting) return;
  const delay = Math.min(30_000, 1_000 * (2 ** state.reconnectAttempts));
  state.reconnectAttempts = Math.min(state.reconnectAttempts + 1, 5);
  log(`SIP reconnect scheduled in ${Math.ceil(delay / 1000)}s`);
  state.reconnectTimer = window.setTimeout(async () => {
    state.reconnectTimer = null;
    state.reconnecting = true;
    try {
      if (state.userAgent) {
        await state.userAgent.stop();
      }
      state.userAgent = null;
      state.registerer = null;
      await setupSip();
      setStatus('Ready');
    } catch (error) {
      setConnectionState(false);
      log(`SIP reconnect failed: ${error.message}`);
      scheduleSipReconnect();
    } finally {
      state.reconnecting = false;
    }
  }, delay);
}

function attachRemoteAudio(session) {
  const peerConnection = session.sessionDescriptionHandler && session.sessionDescriptionHandler.peerConnection;
  if (!peerConnection) return;

  const remoteStream = new MediaStream();
  peerConnection.getReceivers().forEach((receiver) => {
    if (receiver.track) remoteStream.addTrack(receiver.track);
  });
  peerConnection.addEventListener('track', (event) => {
    event.streams.forEach((stream) => {
      stream.getTracks().forEach((track) => remoteStream.addTrack(track));
    });
    remoteAudio.srcObject = remoteStream;
  });
  remoteAudio.srcObject = remoteStream;
}

function watchSession(session) {
  session.stateChange.addListener((sessionState) => {
    switch (sessionState) {
      case SIP.SessionState.Establishing:
        setStatus('Calling');
        setCallInfo(`Calling ${state.target || 'the destination'}...`);
        startCallingTone();
        break;
      case SIP.SessionState.Established:
        stopCallingTone();
        attachRemoteAudio(session);
        setStatus('Active');
        setCallControls(true);
        log('Call connected');
        setCallInfo('Call connected. Speak normally; your microphone is active.');
        startCallTimer();
        break;
      case SIP.SessionState.Terminated:
        stopCallingTone();
        stopCallTimer();
        setStatus('Ended');
        log('Call ended');
        if (remoteAudio.srcObject) {
          remoteAudio.srcObject.getTracks().forEach((track) => track.stop());
          remoteAudio.srcObject = null;
        }
        state.session = null;
        state.muted = false;
        muteButton.textContent = 'Mute';
        setCallControls(false);
        state.target = null;
        setCallInfo('Call ended. Enter another number to call again.');
        break;
      default:
        break;
    }
  });
}

async function callNumber() {
  if (state.session) {
    setCallInfo('A call is already in progress. Hang up before starting another call.');
    log('A call is already active');
    return;
  }
  const target = normalizeNumber(numberInput.value);
  if (!target) {
    setStatus('Ready');
    setCallInfo('Enter a phone number before pressing Call.');
    log('No number entered');
    return;
  }
  if (!isDialableNumber(target)) {
    log('Enter a valid phone number');
    setStatus('Invalid number');
    setCallInfo('That number is not valid. Use 3 to 20 digits, optionally starting with +.');
    return;
  }

  try {
    getAudioContext();
    setStatus('Preparing');
    setCallInfo(`Preparing your microphone and connection for ${target}...`);
    log(`Dialing ${target}`);

    await ensureAudio();
    const userAgent = state.userAgent || await setupSip();
    const targetUri = SIP.UserAgent.makeURI(`sip:${target}@${config.domain}`);
    if (!targetUri) throw new Error('Invalid destination number');

    state.target = target;
    state.session = new SIP.Inviter(userAgent, targetUri, {
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false }
      }
    });
    watchSession(state.session);
    setCallControls(true);
    setStatus('Calling');
    setCallInfo(`Calling ${target}... Waiting for the SIP server.`);
    startCallingTone();
    await state.session.invite();
  } catch (error) {
    stopCallingTone();
    state.session = null;
    state.target = null;
    setCallControls(false);
    const reason = errorReason(error);
    setStatus('Failed');
    setCallInfo(`Call failed: ${reason}`);
    log(`Call failed: ${reason}`);
  }
}

function hangUp() {
  if (state.session) {
    try {
      if (state.session.state === SIP.SessionState.Established) {
        state.session.bye();
      } else if (typeof state.session.cancel === 'function') {
        state.session.cancel();
      } else {
        state.session.reject();
      }
      log('Call terminated');
      setStatus('Ended');
      setCallInfo('Call ended by you.');
      setCallControls(false);
    } catch (error) {
      log(`Hangup error: ${error.message}`);
    }
  }
}

function toggleMute() {
  state.muted = !state.muted;
  const peerConnection = state.session && state.session.sessionDescriptionHandler
    ? state.session.sessionDescriptionHandler.peerConnection
    : null;
  if (peerConnection) {
    peerConnection.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') sender.track.enabled = !state.muted;
    });
  }
  muteButton.textContent = state.muted ? 'Unmute' : 'Mute';
  playTone(state.muted ? 220 : 330, 0.08, 'sine', 0.025);
  setCallInfo(state.muted ? 'Microphone muted.' : 'Microphone unmuted.');
  log(state.muted ? 'Microphone muted' : 'Microphone unmuted');
}

async function init() {
  if (sessionStorage.getItem(AUTH_STORAGE_KEY) !== 'true') {
    loginScreen.hidden = false;
    dialerScreen.hidden = true;
    loginForm.querySelector('input').focus();
    return;
  }

  loginScreen.hidden = true;
  dialerScreen.hidden = false;
  setCallControls(false);
  bindDigits();
  menuButton.addEventListener('click', toggleUtilityMenu);
  refreshSettingsButton.addEventListener('click', loadRuntimeSettings);
  await loadRuntimeSettings();
  await loadRuntimeConfig();

  try {
    await setupSip();
    log('Browser SIP client initialized');
  } catch (error) {
    log(`Setup error: ${error.message}`);
    setStatus('Setup error');
    scheduleSipReconnect();
  }

  callButton.addEventListener('click', callNumber);
  hangupButton.addEventListener('click', hangUp);
  muteButton.addEventListener('click', toggleMute);
  numberInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') callNumber();
    if (event.key === 'Escape') {
      numberInput.value = '';
      updateNumberHint();
    }
  });
  numberInput.addEventListener('input', updateNumberHint);
  backspaceButton.addEventListener('click', () => {
    numberInput.value = numberInput.value.slice(0, -1);
    numberInput.focus();
    updateNumberHint();
  });
  updateNumberHint();
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const username = formData.get('username');
  const password = formData.get('password');

  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
    loginError.hidden = true;
    init();
    return;
  }

  loginError.hidden = false;
  loginForm.querySelector('input[name="password"]').value = '';
});

logoutButton.addEventListener('click', () => {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  window.location.reload();
});

init();
