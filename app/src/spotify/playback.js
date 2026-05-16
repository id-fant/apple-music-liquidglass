// Spotify Web Playback SDK wrapper. Exposes the same shape as
// audio-engine.js so player.js consumes either engine the same way:
//   load(track)  → set/queue the Spotify URI
//   play()       → resume / start the loaded track
//   pause()      → pause
//   seek(pct)    → seek to (pct * duration)
//   setVolume(v) → 0..1
//   isPlaying()  → boolean
//   on(type, cb) → 'time' (curSec, totSec) | 'end'
//
// The SDK creates a Spotify Connect device in the browser. We transfer
// playback to it on init so the user's transport buttons drive *this*
// device (not whatever else they had open). Premium account required —
// the SDK silently no-ops for free users.
//
// Track shape from spotify/catalog.js already carries `id` (Spotify track
// id) and `duration` ("m:ss"). We build the URI as spotify:track:{id}.

import { refreshIfNeeded } from './auth.js';
import {
  transferPlayback,
  playTracks,
  pausePlayback,
  nextTrack as apiNext,
  previousTrack as apiPrevious,
  seekTo,
  setVolume as apiSetVolume,
} from './catalog.js';

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';

function loadSdk() {
  if (window.Spotify?.Player) return Promise.resolve();
  return new Promise((resolve, reject) => {
    // The SDK calls window.onSpotifyWebPlaybackSDKReady when loaded.
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement('script');
    s.src = SDK_SRC;
    s.async = true;
    s.onerror = () => reject(new Error('Failed to load Spotify SDK'));
    document.head.appendChild(s);
  });
}

function parseDuration(s) {
  const [m, sec] = String(s || '0:00').split(':').map(Number);
  return (m || 0) * 60 + (sec || 0);
}

export async function createSpotifyEngine() {
  await loadSdk();

  const listeners = { time: [], end: [], ready: [] };
  const emit = (type, ...args) => {
    for (const cb of listeners[type] || []) cb(...args);
  };

  let deviceId = null;
  let player = null;
  let track = null;       // last loaded track (our shape)
  let isPlaying = false;
  let durationSec = 0;
  let positionSec = 0;
  // Bookkeeping for the SDK's coarse position updates — we tick locally so
  // the scrub bar moves smoothly between state events.
  let lastStateAt = 0;
  let tickHandle = null;

  function stopTick() {
    if (tickHandle) cancelAnimationFrame(tickHandle);
    tickHandle = null;
  }
  function startTick() {
    stopTick();
    const tick = () => {
      if (!isPlaying) return;
      const elapsed = (performance.now() - lastStateAt) / 1000;
      const cur = Math.min(durationSec, positionSec + elapsed);
      emit('time', cur, durationSec);
      if (cur >= durationSec && durationSec > 0) {
        emit('end');
        return;
      }
      tickHandle = requestAnimationFrame(tick);
    };
    tickHandle = requestAnimationFrame(tick);
  }

  player = new window.Spotify.Player({
    name: 'Lumen',
    getOAuthToken: async (cb) => {
      const token = await refreshIfNeeded();
      cb(token);
    },
    volume: 0.8,
  });

  // SDK lifecycle. `ready` arrives with the device id we transfer playback to.
  await new Promise((resolve, reject) => {
    player.addListener('ready', async ({ device_id }) => {
      deviceId = device_id;
      // Transfer playback so this browser is the active device. `play: false`
      // because we don't want to auto-start whatever was previously playing.
      try {
        await transferPlayback(device_id, false);
      } catch (err) {
        console.warn('[Spotify] transferPlayback failed (will retry on first play):', err.message);
      }
      resolve();
    });
    player.addListener('not_ready', ({ device_id }) => {
      console.warn('[Spotify] Device went offline:', device_id);
    });
    player.addListener('initialization_error', ({ message }) => reject(new Error('SDK init: ' + message)));
    player.addListener('authentication_error', ({ message }) => reject(new Error('SDK auth: ' + message)));
    player.addListener('account_error', ({ message }) => {
      // Premium required — bubble up so caller can fall back gracefully.
      reject(new Error('SDK account: ' + message));
    });
    player.addListener('player_state_changed', (state) => {
      if (!state) return;
      isPlaying = !state.paused;
      durationSec = (state.duration || 0) / 1000;
      positionSec = (state.position || 0) / 1000;
      lastStateAt = performance.now();
      emit('time', positionSec, durationSec);
      if (isPlaying) startTick();
      else stopTick();
      // Spotify signals end-of-track via `track_window.previous_tracks`
      // gaining the just-finished track AND paused=true at position 0.
      // Cleanest: when position hits duration, emit 'end' (handled in tick).
    });
    player.connect().then((ok) => {
      if (!ok) reject(new Error('Spotify SDK refused to connect'));
    });
  });

  return {
    async load(t) {
      track = t;
      durationSec = parseDuration(t.duration);
      positionSec = 0;
      isPlaying = false;
      stopTick();
      emit('time', 0, durationSec);
      // We don't auto-start on load — player.js calls play() after load()
      // when autoplay was requested. Just remember the track for play().
    },
    async play() {
      if (!track || !deviceId) return;
      try {
        // If the SDK already has this track loaded, resume() is cheaper
        // than re-sending the URI. Check state first.
        const state = await player.getCurrentState();
        const sameTrack = state?.track_window?.current_track?.id === track.id;
        if (sameTrack && state?.paused) {
          await player.resume();
        } else {
          await playTracks({ uris: [`spotify:track:${track.id}`], deviceId });
        }
        isPlaying = true;
        lastStateAt = performance.now();
        startTick();
      } catch (err) {
        console.warn('[Spotify] play failed:', err.message);
      }
    },
    async pause() {
      if (!track) return;
      try {
        await player.pause();
        isPlaying = false;
        stopTick();
      } catch (err) {
        // Fallback through API if SDK call fails.
        try { await pausePlayback(deviceId); } catch {}
      }
    },
    async seek(progress) {
      const targetMs = Math.max(0, Math.round(progress * durationSec * 1000));
      try {
        await player.seek(targetMs);
      } catch {
        try { await seekTo(targetMs, deviceId); } catch {}
      }
      positionSec = targetMs / 1000;
      lastStateAt = performance.now();
      emit('time', positionSec, durationSec);
    },
    async setVolume(v) {
      const clamped = Math.max(0, Math.min(1, v));
      try {
        await player.setVolume(clamped);
      } catch {
        try { await apiSetVolume(clamped * 100, deviceId); } catch {}
      }
    },
    isPlaying() {
      return isPlaying;
    },
    on(type, cb) {
      (listeners[type] ||= []).push(cb);
    },
    // Spotify-specific extras for the controller to use when wiring
    // skip-to-next / skip-to-previous to actual playback.
    async nextTrack() {
      try { await apiNext(deviceId); } catch (err) { console.warn(err); }
    },
    async previousTrack() {
      try { await apiPrevious(deviceId); } catch (err) { console.warn(err); }
    },
    getDeviceId() { return deviceId; },
  };
}
