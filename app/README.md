# Lumen — Liquid Glass Player

An Apple Music–inspired web player with a frosted "liquid glass" / Frutiger Aero aesthetic. Browser-only, no backend.

## Stack

- Vite 5 + React 18 — React is used only for the floating Tweaks panel; the entire UI runs on vanilla JS.
- HTML5 `<audio>` for playback (falls back to a simulated timeline when a track has no preview URL).
- Two interchangeable catalog backends behind one interface: **iTunes Search** (no auth) and **Spotify Web API** (PKCE OAuth).

## Run it

```bash
cd app
npm install
npm run dev
```

Vite serves at `http://127.0.0.1:5173/`. The app boots in iTunes mode by default — searchable artists, top albums and songs charts, and 30-second preview playback.

## Spotify mode (optional)

Connecting Spotify unlocks user-library views (Recently Added, Songs, Albums, Artists, your playlists), your real #1 top artist on For You, and personal top tracks for Radio.

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Add `http://127.0.0.1:5173/` as a redirect URI (exact match, including the trailing slash). Spotify rejects `localhost` for new apps.
3. Add your account email under **User Management** while the app is in development mode.
4. Copy the Client ID into `app/.env`:

   ```
   VITE_SPOTIFY_CLIENT_ID=your_client_id_here
   ```

   PKCE doesn't need a client secret — don't add one (anything `VITE_*`-prefixed is bundled into the production build).

5. Click the connect-Spotify icon in the title bar.

**Premium requirement**: Spotify's Web API blocks free accounts in development-mode apps. If you sign in without Premium, the title bar surfaces a "Premium required" status, the library views explain why they're empty, and the rest of the app continues to work via the iTunes catalog. To unblock without Premium, request "Extended Quota Mode" in the Spotify dashboard.

## Features

- **For You** auto-cycles through featured artists every 14 seconds (iTunes mode rotates through chart leaders; Spotify mode locks on your #1 top artist). The hero slides between artists for a carousel feel. Click the hero to lock onto that artist's catalogue.
- **Artist pages** are visually distinct from the For You landing — taller hero, bigger display title, no auto-rotation.
- **Singles** are split into their own section, separate from full-length albums in Discography.
- **Album rails** scroll horizontally with scroll-snap.
- **Segmented tabs** (Overview / Songs / Discography) filter what's visible on artist pages. Tab clicks replay the view-enter animation.
- **Liked tracks** persist in `localStorage`, keyed by track id — survives navigation and reloads.
- **Playback persists** across view changes — switching tabs no longer interrupts what's playing.
- **Optimistic navigation** — the page dims and softens the moment you click, before the network responds.
- **Accessibility** — `prefers-reduced-motion` clamps all animations and transitions to ~0ms.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Previous / next track |
| `↑` `↓` | Volume ±5% |
| `L` | Like / unlike the current track |
| `M` | Mute toggle (remembers previous level) |
| `/` | Focus the search bar |

Shortcuts are suppressed while typing into an input field.

## Layout

```
app/
├── index.html                — DOM shell with all element ids
├── public/audio/             — local mp3s (gitignored, .gitkeep tracked)
└── src/
    ├── main.js               — boot, navigator, sidebar/search/auth wiring
    ├── player.js             — view system, render functions, state
    ├── audio-engine.js       — <audio> wrapper, sim fallback
    ├── views.js              — view loaders (For You, artist, album, playlist, library, browse, radio)
    ├── featured-artists.js   — fallback rotation when no listening history exists
    ├── tracks.js             — static demo data
    ├── styles.css            — all CSS (vars, glass material, animations, mobile rules)
    ├── itunes/{api,catalog}.js
    ├── spotify/{api,auth,catalog}.js
    └── tweaks/{mount,TweaksPanel,controls}.jsx + apply.js
```

## Configuration

### Tweaks panel

Click the slider icon in the title bar. Adjusts blur, saturation, glass tint, edge strength, backdrop palette, and accent color live. Settings persist to `localStorage.lumen.tweaks`.

### Fonts

Three CSS variables in `:root` ([src/styles.css](src/styles.css)) drive every typeface:

```css
--font-body:    'Inter', system-ui, sans-serif;
--font-display: 'Instrument Serif', serif;
--font-mono:    'JetBrains Mono', monospace;
```

To swap a font: edit the variable AND update the matching family in the Google Fonts `<link>` at the top of `index.html`.

### Motion

Two custom easings + two durations live alongside the font vars:

```css
--ease-out-strong:    cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1);
--dur-press: 140ms;
--dur-snap:  220ms;
```

All button presses, view transitions, hero slides, card entrances, and tab switches use these. Edit centrally to tune the feel of the whole app.

## Build

```bash
cd app
npm run build
```

Outputs to `app/dist/`. The build is a static site — drop the `dist/` folder on any HTTP host.
