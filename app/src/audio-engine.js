// Wraps the page's <audio id="audio"> element and exposes a small event-based
// API (load / play / pause / seek / setVolume + on('time' | 'end')).
//
// When the loaded track has no `audio` URL, we fall back to a simulated
// timeline so the demo still feels alive — the bar moves, tracks advance —
// even before any real files are dropped into public/audio/.
//
// To swap in Apple Music / MusicKit JS later, replace the body of this
// module with calls to MusicKit's player while keeping the public shape
// the same. The rest of the app only knows about this interface.

function parseDuration(s) {
  const [m, sec] = s.split(':').map(Number);
  return m * 60 + sec;
}

export function createAudioEngine(audioEl) {
  const listeners = { time: [], end: [] };
  let track = null;
  let isReal = false;
  let isPlaying = false;

  // Sim state (used when track has no audio URL)
  let simDuration = 0;
  let simElapsed = 0;
  let simAnchor = 0;
  let simRaf = null;

  const emit = (type, ...args) => {
    for (const cb of listeners[type] || []) cb(...args);
  };

  const stopSim = () => {
    if (simRaf) cancelAnimationFrame(simRaf);
    simRaf = null;
  };

  const tickSim = () => {
    const elapsed = isPlaying ? simElapsed + (performance.now() - simAnchor) / 1000 : simElapsed;
    if (elapsed >= simDuration) {
      isPlaying = false;
      simElapsed = simDuration;
      stopSim();
      emit('time', simDuration, simDuration);
      emit('end');
      return;
    }
    emit('time', elapsed, simDuration);
    simRaf = requestAnimationFrame(tickSim);
  };

  audioEl.addEventListener('timeupdate', () => {
    if (isReal) emit('time', audioEl.currentTime, audioEl.duration || simDuration);
  });
  audioEl.addEventListener('ended', () => {
    if (isReal) {
      isPlaying = false;
      emit('end');
    }
  });
  audioEl.addEventListener('loadedmetadata', () => {
    if (isReal) emit('time', audioEl.currentTime, audioEl.duration || simDuration);
  });

  return {
    load(t) {
      stopSim();
      track = t;
      isPlaying = false;
      isReal = !!t.audio;
      simDuration = parseDuration(t.duration);
      simElapsed = 0;
      if (isReal) {
        audioEl.src = t.audio;
        audioEl.load();
      } else {
        audioEl.removeAttribute('src');
      }
      emit('time', 0, simDuration);
    },

    play() {
      if (!track) return;
      isPlaying = true;
      if (isReal) {
        audioEl.play().catch((err) => {
          // Autoplay blocked or src missing — fall back to sim so the UI moves.
          isReal = false;
          simAnchor = performance.now();
          simRaf = requestAnimationFrame(tickSim);
          console.warn('Audio playback failed, simulating:', err.message);
        });
      } else {
        simAnchor = performance.now();
        simRaf = requestAnimationFrame(tickSim);
      }
    },

    pause() {
      if (!track) return;
      if (isReal) {
        audioEl.pause();
      } else if (isPlaying) {
        simElapsed += (performance.now() - simAnchor) / 1000;
        stopSim();
      }
      isPlaying = false;
    },

    seek(progress) {
      const target = progress * simDuration;
      if (isReal) {
        audioEl.currentTime = progress * (audioEl.duration || simDuration);
      } else {
        simElapsed = target;
        simAnchor = performance.now();
        emit('time', target, simDuration);
      }
    },

    setVolume(v) {
      audioEl.volume = Math.max(0, Math.min(1, v));
    },

    isPlaying() {
      return isPlaying;
    },

    on(type, cb) {
      (listeners[type] ||= []).push(cb);
    },
  };
}
