// Cover gradients used by both the track rows and the now-playing chrome.
// Indexed by track.cover.
export const COVERS = [
  'linear-gradient(135deg,#6ee7ff,#3b6cff)',
  'linear-gradient(135deg,#b388ff,#5a1d8c)',
  'linear-gradient(135deg,#7cf2a5,#0d4f3c)',
  'linear-gradient(135deg,#ffd166,#ef476f)',
  'linear-gradient(135deg,#ff7eb6,#5a1d3a)',
  'linear-gradient(135deg,#a0e7ff,#1a3b6b)',
];

// `audio` is the URL the player streams from. It can be:
//   • a path under public/  (e.g. '/audio/hover-years.mp3'), or
//   • any full https URL.
//
// Defaults below point at SoundHelix's royalty-free demo MP3s — they're a
// long-running test source widely used for audio examples, so you can hit
// Play immediately. Replace each one with your own track once you have it.
//
// If `audio` is empty, the engine falls back to a simulated progress bar
// (the visual demo still works, but no sound plays).
//
// Apple Music / MusicKit JS plug-in point: swap the engine in
// audio-engine.js to drive MusicKit directly, or set `audio` to MusicKit
// stream URLs returned from the library/search APIs.
export const TRACKS = [
  { id: 'hover-years',          n:1, title:'Hover Years',          album:'Hover Years — EP', plays:'12,481,920', duration:'3:48', cover:1, audio:'/audio/hover-years.mp3.mp3' },
  { id: 'coastline-in-reverse', n:2, title:'Coastline in Reverse', album:'Salt & Glass',     plays:'8,703,114',  duration:'6:09', cover:0, audio:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 'margin-of-error',      n:3, title:'Margin of Error',      album:'Salt & Glass',     plays:'6,219,008',  duration:'7:00', cover:4, audio:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 'almost-a-postcard',    n:4, title:'Almost a Postcard',    album:'Linen Sunday',     plays:'4,998,302',  duration:'7:43', cover:2, audio:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: 'quiet-briefly',        n:5, title:'Quiet, Briefly',       album:'Hover Years — EP', plays:'3,544,191',  duration:'6:21', cover:3, audio:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
  { id: 'new-glass',            n:6, title:'New Glass',            album:'Salt & Glass',     plays:'2,901,747',  duration:'6:30', cover:5, audio:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
];

export const ARTIST = 'Marisol Vega';
