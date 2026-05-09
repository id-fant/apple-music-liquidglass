# Lumen — Liquid Glass Player

An Apple Music–inspired web player with a frosted "liquid glass" / Frutiger Aero aesthetic. Browser-only, no backend.

## Stack

- Vite 5 + React 18 (React is used only for the floating Tweaks panel; everything else is vanilla JS)
- HTML5 `<audio>` for playback
- Two interchangeable catalog backends behind one interface: **iTunes Search** (no auth) and **Spotify Web API** (PKCE OAuth)

## Run it

```bash
cd app
npm install
npm run dev
```

Vite serves at `http://127.0.0.1:5173/`. The app boots in iTunes mode by default — searchable artists, top albums and songs charts, and 30-second preview playback.

## Spotify mode (optional)

Connect Spotify to unlock the user-library views (Recently Added, Songs, Albums, Artists, your playlists, real top artist).

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Add `http://127.0.0.1:5173/` as a redirect URI (exact match, including the trailing slash). Spotify rejects `localhost` for new apps.
3. Add your account email under **User Management** while the app is in development mode.
4. Copy the Client ID into `app/.env`:

   ```
   VITE_SPOTIFY_CLIENT_ID=your_client_id_here
   ```

   PKCE doesn't need a client secret — don't add one (anything `VITE_*`-prefixed is bundled into the production build).

5. Click the connect-Spotify icon in the title bar.

Spotify Premium is required for full-track playback (Web Playback SDK). Without Premium the app falls back to iTunes mode automatically.

## Layout

```
app/
├── index.html
├── public/audio/      # local mp3s (gitignored)
└── src/
    ├── main.js        # entry: boot, navigation, DOM wiring
    ├── styles.css
    ├── player.js      # vanilla view system
    ├── views.js       # view factories
    ├── itunes/        # iTunes Search + Apple charts
    ├── spotify/       # PKCE OAuth + Web API client
    └── tweaks/        # React Tweaks panel
```

## Tweaks panel

Click the slider icon in the title bar. Adjusts blur, saturation, glass tint, edge strength, backdrop palette, and accent color live. Persisted to `localStorage`.
