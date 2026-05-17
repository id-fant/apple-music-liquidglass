# Lumen — Liquid Glass Player

An Apple Music–inspired web player with an iOS 26 / Frutiger Aero "liquid glass" aesthetic — translucent surfaces, backdrop blur, refractive saturation, and floating album-art gradient blobs. Browser-only, no backend.

## Stack

- **Vite 5 + React 18** — React is used only for the floating Tweaks panel; the entire UI runs on vanilla JS.
- **HTML5 `<audio>`** for preview playback (iTunes mode) with a simulated timeline when no audio URL is available.
- **Spotify Web Playback SDK** for full-song playback (Premium mode) — Lumen registers itself as a Spotify Connect device in the browser.
- **Two interchangeable catalog backends** behind one interface: **iTunes Search** (no auth) and **Spotify Web API** (PKCE OAuth).

## Run it

```bash
cd app
npm install
npm run dev
```

Vite serves at `http://127.0.0.1:5173/`. The app boots in iTunes mode by default — searchable artists, top albums and songs charts, and 30-second preview playback.

## Spotify mode

Connecting Spotify unlocks user-library views (Recently Added, Songs, Albums, Artists, your playlists), your real #1 top artist on For You, and — with Premium — full-song playback, like/unlike that syncs to your Spotify library, and add-to-queue.

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Add `http://127.0.0.1:5173/` as a redirect URI (exact match, trailing slash). Spotify rejects `localhost` for new apps.
3. Add your account email under **User Management** while the app is in development mode.
4. Copy the Client ID into `app/.env`:

   ```
   VITE_SPOTIFY_CLIENT_ID=your_client_id_here
   ```

   PKCE doesn't need a client secret — **don't add one** (anything `VITE_*`-prefixed is bundled into the production JS where anyone can extract it with DevTools).

5. Click the connect-Spotify icon in the title bar.

**Premium gating**: full-song playback, like-sync, queue control, and most user-library views all require Premium (Spotify's Web API and SDK refuse free accounts in development-mode apps). Without Premium, Lumen falls back gracefully to iTunes mode for browsing, with a "Premium required" status surfaced in the title bar and library views. To unblock without Premium, request Extended Quota Mode in the Spotify dashboard.

## Features

### Playback
- **Full-song playback** in Spotify Premium mode via the Web Playback SDK — the browser becomes a Spotify Connect device.
- **30-second previews** in iTunes mode (or Spotify free).
- **Apple-Music-style fullscreen now-playing**: tap the transport bar (desktop) or minibar (mobile). Floating album-color gradient blobs sampled from the cover via canvas, scale-on-pause cover, scrub bar, shuffle / repeat / like, and a More-options bottom sheet.
- **Back arrow** in the fullscreen top-left dismisses; ESC works too.

### Discovery
- **For You** auto-cycles through featured artists every 14s (iTunes mode rotates chart leaders; Spotify locks on your #1 top artist).
- **Artist pages** with hero, top tracks, Discography rail, Singles rail (separate from albums when present).
- **Album pages** — the artist name above the Play button is a clickable link to that artist's discography.
- **"See all"** on Discography / Singles toggles the rail between horizontal scroll and a responsive wrapping grid.
- **Segmented tabs** (Overview / Songs / Discography) filter what's visible.

### Library
- **Like / Unlike** (heart icon) — local-only in iTunes mode; syncs to your Spotify library (`PUT /v1/me/tracks`) in Spotify mode, with optimistic UI and rollback on failure.
- **Your playlists** populate the sidebar when connected with Spotify Premium.
- **Recently Added / Songs / Albums / Artists** pull from your actual Spotify library.

### Track rows
- **3-dot context menu** on every row: Add to Queue (Spotify), Go to Artist, Like / Unlike, Copy Link, Open in Spotify. Liquid-glass popover positioned to the anchor.
- **Marquee scrolling** for long titles and album names — text smoothly scrolls horizontally to reveal the full content. Detects overflow via `ResizeObserver` so it re-evaluates on resize, rotation, and layout changes. Container width stays bounded; only the inner text moves.

### Mobile UX
- **Six responsive tiers** (≤1200, ≤980, ≤640, ≤500, ≤380, ≤360, ≤300, plus landscape-short).
- **Bottom tab bar** with 5 destinations (Listen Now, Browse, Radio, Library, Search). Active tab gets a translucent iOS 26 glass pill behind it.
- **Mobile drawer** (`.side`) is ~65% opaque with `backdrop-filter: blur(28px) saturate(1.6)` so ~35% of the background refracts through.
- **Now-playing minibar** stretches the full device width; tapping it opens the fullscreen player.
- **Edge-anchored bottom bars** — minibar and tabbar span exactly the detected screen width via a JS-tracked `--device-w` CSS variable.

### Polish
- **Liquid glass material** everywhere — backdrop blur, saturate, top-edge sheen, inner highlight, soft drop shadow.
- **Track-change cover zoom** in the fullscreen player — scales from 1.08 → 1 with fade-in over 520ms (pure compositor properties, no filter blur for max perf).
- **iOS-26 button press**: `scale(0.96)` on `:active` (Emil's 0.95–0.98 band), hover gated behind `(hover: hover)` so touch devices don't stick.
- **`prefers-reduced-motion`** clamps all animations to ~0ms.

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
├── index.html
├── public/audio/                 — local mp3s (gitignored)
└── src/
    ├── main.js                   — boot, navigation, viewport tracking, DOM wiring
    ├── styles.css                — all CSS (~1800 lines)
    ├── player.js                 — vanilla view system, marquee, row menu, fullscreen
    ├── audio-engine.js           — local <audio> wrapper + sim fallback
    ├── views.js                  — view loaders (For You, artist, album, playlist, etc.)
    ├── featured-artists.js       — fallback artist rotation
    ├── tracks.js                 — static demo data
    ├── itunes/{api,catalog}.js
    ├── spotify/
    │   ├── api.js                — fetch wrapper (GET/PUT/POST/DELETE)
    │   ├── auth.js               — PKCE OAuth flow
    │   ├── catalog.js            — Web API endpoints (catalog, library, queue, transport)
    │   └── playback.js           — Web Playback SDK engine (Premium full-song playback)
    └── tweaks/{mount,TweaksPanel,controls}.jsx + apply.js
```

## Tweaks panel

Click the slider icon in the title bar. Adjusts blur, saturation, glass tint, edge strength, and accent color live. Persisted to `localStorage.lumen.tweaks`.

## Build

```bash
cd app
npm run build
```

Outputs to `app/dist/`. The build is a static site — drop the `dist/` folder on any HTTP host.

## Roadmap

Deferred from the foundation work — see [HANDOFF.md](HANDOFF.md) for full estimates:

- **Queue panel UI** — drag-to-reorder list of upcoming tracks, click-to-skip. Web API is already wired.
- **Lyrics** via LRCLib — synced scrolling lyrics in the fullscreen player.
- **Recently Played view** — local history of the last 50 played tracks.
- **Search filters** — Tracks / Albums tabs in the search dropdown.
- **Local mp3 import** — drag-and-drop files for offline-style playback.
- **Stats / Wrapped** view — top tracks, artists, genres across all time ranges (Spotify-only).
- **PWA** — installable as a desktop/mobile app via `vite-plugin-pwa`.
