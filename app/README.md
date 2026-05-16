# Lumen — Liquid Glass Player

An Apple Music–inspired web player with an iOS 26 / Frutiger Aero "liquid glass" aesthetic — translucent surfaces, backdrop blur, refractive saturation, and floating album-art gradient blobs. Browser-only, no backend.

## Stack

- **Vite 5 + React 18** — React is used only for the floating Tweaks panel; the entire UI runs on vanilla JS.
- **HTML5 `<audio>`** for 30-second preview playback (iTunes mode), with a simulated timeline when no audio URL is available.
- **Spotify Web Playback SDK** for full-song playback (Premium mode) — the browser registers as a Spotify Connect device.
- **Two interchangeable catalog backends** behind one interface: **iTunes Search** (no auth) and **Spotify Web API** (PKCE OAuth).

## Run it

```bash
cd app
npm install
npm run dev
```

Vite serves at `http://127.0.0.1:5173/`. The app boots in iTunes mode by default — searchable artists, top albums and songs charts, and 30-second preview playback.

## Spotify mode

Connecting Spotify unlocks user-library views (Recently Added, Songs, Albums, Artists, your playlists), your real #1 top artist on For You, and — with Premium — full-song playback, like-sync to your Spotify library, and add-to-queue.

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Add `http://127.0.0.1:5173/` as a redirect URI (exact match, including the trailing slash). Spotify rejects `localhost` for new apps.
3. Add your account email under **User Management** while the app is in development mode.
4. Copy the Client ID into `app/.env`:

   ```
   VITE_SPOTIFY_CLIENT_ID=your_client_id_here
   ```

   PKCE doesn't need a client secret — **don't add one** (anything `VITE_*`-prefixed is bundled into the production JS where anyone can extract it with DevTools).

5. Click the connect-Spotify icon in the title bar.

### Scopes requested

| Scope                          | Used for                                       |
| ------------------------------ | ---------------------------------------------- |
| `user-read-private`            | Profile, country / market detection            |
| `user-read-email`              | Account display                                |
| `streaming`                    | Web Playback SDK (Premium full-song playback)  |
| `user-top-read`                | For You #1 artist, Radio top tracks            |
| `user-library-read`            | Liked status hydration on render               |
| `user-library-modify`          | Like / unlike sync with Spotify library        |
| `user-follow-read`             | Followed Artists view                          |
| `user-read-playback-state`     | Current playback state for transport sync      |
| `user-modify-playback-state`   | Transport control, add-to-queue, transfer device |
| `playlist-read-private`        | Your private playlists in the sidebar          |
| `playlist-read-collaborative`  | Collaborative playlists in the sidebar         |

**Premium gating**: full-song playback, like-sync, queue control, and most user-library views all require Premium. Without Premium, Lumen falls back gracefully to iTunes mode for browsing, with a "Premium required" status surfaced in the title bar and library views. To unblock without Premium, request **Extended Quota Mode** in the Spotify dashboard.

## Features

### Playback

- **Full-song playback** via the Spotify Web Playback SDK in Premium mode. The browser becomes a Spotify Connect device, and Lumen transfers playback to it on init so the transport buttons drive the SDK.
- **30-second previews** in iTunes mode (or when a Spotify track has no `preview_url`).
- **Apple-Music-style fullscreen now-playing** — tap the transport bar (desktop) or minibar (mobile). Centered cover that scales 14% smaller on pause, slide-up entrance, floating album-color gradient blobs sampled from the cover via canvas. Back arrow in the top-left (or Esc) dismisses.
- **More-options bottom sheet** in fullscreen with Lyrics / Playing Next / Devices / Share (current placeholders; Lyrics + Queue panel are next on the roadmap).

### Discovery

- **For You** auto-cycles through featured artists every 14 seconds (iTunes mode rotates chart leaders; Spotify mode locks on your #1 top artist). The hero slides between artists for a carousel feel. Click the hero to lock onto that artist's catalogue and stop the rotation.
- **Artist pages** with hero, top tracks, Discography rail, and a separate Singles rail when present.
- **Album pages** — the artist name above the Play button is a clickable link to the artist's discography (works in both the album view and the fullscreen now-playing).
- **"See all"** on Discography / Singles rails toggles between horizontal scroll and a responsive wrapping grid (auto-fill columns sized for the viewport).
- **Segmented tabs** (Overview / Songs / Discography) filter what's visible; tab clicks replay the view-enter animation.

### Library

- **Like / Unlike** (heart icon) — local-only in iTunes mode (persisted to `localStorage.lumen.likes`); syncs to your Spotify library (`PUT /v1/me/tracks`) in Spotify mode with optimistic UI and rollback on failure.
- **Liked status hydration** — on first paint in Spotify mode, displayed tracks are batch-checked against `/v1/me/tracks/contains` so hearts reflect your real library.
- **Your playlists** populate the sidebar when connected with Spotify Premium (replaces the demo gradient playlists).
- **Recently Added / Songs / Albums / Artists** pull from your actual Spotify library.

### Track rows

- **3-dot context menu** on every row, with items: Add to Queue (Spotify), Go to Artist, Like / Unlike, Copy Link (Spotify track URL), Open in Spotify (new tab). Liquid-glass popover positioned to the anchored 3-dots with click-outside / Esc / scroll dismissal.
- **Marquee scrolling** for long titles and album names — text smoothly scrolls horizontally to reveal the full content. Wrapped in an inner `<span class="marquee-text">` and animated via CSS transforms (GPU-composited). Detects overflow via `ResizeObserver` so it re-evaluates on resize, rotation, drawer open/close, and "See all" toggle.

### Mobile UX

- **Six responsive tiers** (≤1200, ≤980, ≤640, ≤500, ≤380, ≤360, ≤300, plus landscape-short). Each tightens hero / cards / rows / tabbar consistently.
- **Bottom tab bar** with 5 destinations (Listen Now, Browse, Radio, Library, Search). Active tab gets a translucent iOS 26 glass pill behind it that scales in from 0.92 + opacity 0 with `cubic-bezier(0.32, 0.72, 0, 1)`.
- **Mobile drawer** is ~65% opaque with `backdrop-filter: blur(28px) saturate(1.6)` — ~35% of the background refracts through.
- **Now-playing minibar** spans the full device width with a top sheen highlight; tapping it opens the fullscreen player.
- **Edge-anchored bottom bars** — minibar and tabbar use `max-width: var(--device-w)` where `--device-w` is a JS-tracked viewport width updated on resize / orientationchange (rAF-throttled).

### Polish

- **Liquid glass material** everywhere — backdrop blur + saturate, 1px top-edge sheen, inner highlight, soft drop shadow.
- **Track-change cover zoom** in the fullscreen player — scales 1.08 → 1 with opacity 0.5 → 1 over 520ms. Pure compositor properties (no filter blur) for max perf.
- **iOS-26 button press** — `scale(0.96)` on `:active` (Emil's 0.95–0.98 band). Hover gated behind `(hover: hover) and (pointer: fine)` so touch devices don't stick.
- **Active row equalizer** — four animated bars replace the track number on the currently-playing row.
- **`prefers-reduced-motion`** clamps all animations and transitions to ~0ms.

## Keyboard shortcuts

| Key       | Action                                    |
| --------- | ----------------------------------------- |
| `Space`   | Play / pause                              |
| `←` / `→` | Previous / next track                     |
| `↑` / `↓` | Volume ±5%                                |
| `L`       | Like / unlike the current track           |
| `M`       | Mute toggle (remembers previous level)    |
| `/`       | Focus the search bar                      |
| `Esc`     | Close the fullscreen player or More sheet |

Shortcuts are suppressed while typing into an input field.

## Layout

```
app/
├── index.html                    — DOM shell with all element ids
├── public/audio/                 — local mp3s (gitignored, .gitkeep tracked)
└── src/
    ├── main.js                   — boot, navigator, sidebar/search/auth wiring, viewport tracking
    ├── styles.css                — all CSS (~1800 lines): vars, glass material, animations, mobile rules
    ├── player.js                 — view system, render functions, state, marquee helper, fullscreen, row menu
    ├── audio-engine.js           — local <audio> wrapper + simulated-timeline fallback
    ├── views.js                  — view loaders (For You, artist, album, playlist, library, browse, radio)
    ├── featured-artists.js       — fallback artist rotation when no listening history
    ├── tracks.js                 — static demo data
    ├── itunes/
    │   ├── api.js                — iTunes Search fetch wrapper
    │   └── catalog.js            — iTunes catalog adapter (shapeTrack / shapeAlbum / shapeArtist)
    ├── spotify/
    │   ├── api.js                — Web API fetch wrapper (GET/PUT/POST/DELETE via spotifyRequest)
    │   ├── auth.js               — PKCE OAuth flow, refreshIfNeeded, logout
    │   ├── catalog.js            — Web API endpoints (catalog, library, queue, transport)
    │   └── playback.js           — Web Playback SDK engine — same interface as audio-engine
    └── tweaks/
        ├── mount.jsx             — React island mount point
        ├── TweaksPanel.jsx       — sliding glass panel
        ├── controls.jsx          — sliders + color pickers
        └── apply.js              — writes :root CSS vars, persists to localStorage
```

## Configuration

### Tweaks panel

Click the slider icon in the title bar. Adjusts blur, saturation, glass tint, edge strength, and accent color live. Settings persist to `localStorage.lumen.tweaks`.

### Fonts

Three CSS variables in `:root` ([src/styles.css](src/styles.css)) drive every typeface:

```css
--font-body:    'Inter', system-ui, sans-serif;
--font-display: 'Instrument Serif', serif;
--font-mono:    'JetBrains Mono', monospace;
```

To swap a font: edit the variable AND update the matching family in the Google Fonts `<link>` at the top of `index.html`.

### Motion

Custom easings + durations live alongside the font vars:

```css
--ease-out-strong:    cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1);
--dur-press: 140ms;
--dur-snap:  220ms;
```

The fullscreen player uses an additional Apple-style curve inline: `cubic-bezier(0.32, 0.72, 0, 1)`. Edit centrally to tune the feel of the whole app.

### Viewport variable

`main.js` tracks `window.innerWidth` and publishes it as `--device-w` on `:root` (rAF-throttled on `resize` / `orientationchange`). Used by `.minibar`, `.tabbar`, and `.tracks` for edge-anchored layout that always matches the real visible viewport (excludes scrollbar width that `100vw` includes).

## Build

```bash
cd app
npm run build
```

Outputs to `app/dist/`. The build is a static site — drop the `dist/` folder on any HTTP host.

## Roadmap

Deferred follow-up work — see [HANDOFF.md](../HANDOFF.md) in the repo root for full estimates:

- **Queue panel UI** — drag-to-reorder list of upcoming tracks, click-to-skip. Web API (`addToQueue`, `fetchQueue`) is already wired through `player.setQueueAdder()`.
- **Lyrics** via [LRCLib](https://lrclib.net) — synced scrolling lyrics in the fullscreen player, hooked into the More sheet's "Lyrics" item.
- **Recently Played view** — local history of the last 50 played tracks.
- **Search filters** — Tracks / Albums tabs in the search dropdown.
- **Local mp3 import** — drag-and-drop files for offline-style playback.
- **Stats / Wrapped** view — top tracks, artists, genres across all three Spotify time ranges (Spotify Premium only).
- **PWA** — installable as a desktop / mobile app via `vite-plugin-pwa`.
