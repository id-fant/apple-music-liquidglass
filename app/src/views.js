// View loaders — each fetches data from a `catalog` and pushes a view
// object into the player. Built as a factory so we can plug in either the
// Spotify or iTunes catalog without changing any of the loaders themselves.
//
// `navigate` is the history-aware navigator from main.js. Internal jumps
// (rail clicks → album/artist) call it so back/forward buttons see the
// transition; top-level entry points (sidebar, search) invoke navigate
// from main.js directly.
//
// Loaders for user-library views (Recently Added, Songs, Albums, Artists,
// Playlists) check whether the catalog implements them; if not (iTunes
// mode), they render a "Connect Spotify" empty state instead of crashing.

// While the For You view is on screen, rotate through the featured artists
// every N ms so it reads as a showcase. Long enough for the user to actually
// look at the artist; short enough to feel alive.
const FEATURED_INTERVAL_MS = 14000;

export function createViews(catalog, navigate, opts = {}) {
  // `authBlocked` differentiates "user never connected" from "user connected
  // but Spotify Web API refuses to talk to them" (Premium-required, or any
  // other probe error). Library views read this to choose between
  // "Connect Spotify" and "Spotify Premium required" messaging.
  const authBlocked = opts.authBlocked || null;

  // Auto-rotation state. The token guards against a stale fetch (kicked off
  // by the timer) landing after the user has navigated to a different view —
  // every non-For-You loader bumps the token before doing its own work.
  let featuredTimer = null;
  let featuredToken = 0;

  function cancelFeaturedRotation() {
    if (featuredTimer) {
      clearTimeout(featuredTimer);
      featuredTimer = null;
    }
    featuredToken++;
  }

  // ── Renderers (shared layouts) ─────────────────────────────────────────

  function renderArtistView(player, data, opts = {}) {
    const a = data.artist;
    const followers = a.followers ? a.followers.toLocaleString() + ' followers' : '';
    const subtitle = a.genres
      ? followers
        ? `${a.genres} · ${followers}`
        : a.genres
      : followers;

    const viewObj = {
      page: { crumb: 'For You', title: 'Today' },
      hero: {
        label: 'Featured Artist',
        title: a.name,
        subtitle,
        artwork: a.artwork,
        bgColor: data.bgColor,
        showPortrait: true,
        primaryAction: { label: 'Play' },
        secondaryAction: { label: 'Following' },
        // Click the hero to lock onto this artist's catalogue. Only set on
        // For You (where the auto-rotation runs); on a stable artist page
        // this is null so the hero isn't a link to itself.
        onClick: opts.allowClick
          ? () => navigate(() => loadArtist(a.id, player))
          : null,
      },
      tracks: { title: 'Popular this month', items: data.tracks || [] },
      rail: data.albums?.length
        ? {
            title: 'Discography',
            variant: 'album',
            items: data.albums,
            onItemClick: (album) => navigate(() => loadAlbum(album.id, player)),
          }
        : { title: '', items: [] },
    };

    if (opts.rotate) {
      player.rotateView(viewObj);
    } else {
      player.setView(viewObj);
    }
  }

  function renderLockedView(player, crumb, title, message) {
    // Replace the generic "Connect Spotify" message with something accurate
    // when the user IS connected but the Web API rejected them. Without
    // this, a Premium-blocked user sees "Connect Spotify..." right after
    // they just connected, with no clue why it's failing.
    const realMessage =
      authBlocked === 'premium'
        ? 'Spotify Web API requires a Premium account in development mode — your connection is fine, but the API won\'t serve free accounts. Upgrade Spotify or have the developer move the app into Extended mode.'
      : authBlocked === 'error'
        ? 'Spotify connected, but the Web API isn\'t reachable right now. Try refreshing.'
      : message;
    const realLabel =
      authBlocked === 'premium' ? 'Spotify Premium required'
      : authBlocked === 'error' ? 'Spotify unavailable'
      : 'Premium feature';

    player.setView({
      page: { crumb, title },
      hero: {
        label: realLabel,
        title,
        subtitle: realMessage,
        artwork: null,
        bgColor: null,
        showPortrait: false,
        primaryAction: null,
        secondaryAction: null,
      },
      tracks: null,
      rail: { title: '', items: [] },
    });
  }

  // ── Loaders ────────────────────────────────────────────────────────────

  async function loadForYou(player, opts = {}) {
    // Each call gets its own token. If the user navigates away while the
    // network call is in flight, cancelFeaturedRotation() will bump the
    // token and we'll bail before rendering stale data.
    const myToken = ++featuredToken;
    const data = await catalog.fetchPrimaryArtist();
    if (myToken !== featuredToken) return;
    renderArtistView(player, data, { allowClick: true, rotate: !!opts.rotate });
    if (featuredTimer) clearTimeout(featuredTimer);
    // Subsequent timer-driven calls use the rotate=true path, which plays
    // the hero slide animation instead of a full-pane re-entrance.
    featuredTimer = setTimeout(() => loadForYou(player, { rotate: true }), FEATURED_INTERVAL_MS);
  }

  async function loadArtist(artistId, player) {
    cancelFeaturedRotation();
    const data = await catalog.getArtistFull(artistId);
    renderArtistView(player, data);
  }

  async function loadAlbum(albumId, player) {
    cancelFeaturedRotation();
    const data = await catalog.getAlbumFull(albumId);
    const a = data.album;
    player.setView({
      page: { crumb: 'Album', title: a.name },
      hero: {
        label: a.type === 'single' ? 'Single' : 'Album',
        title: a.name,
        subtitle: `${a.artist}${a.year ? ` · ${a.year}` : ''} · ${data.tracks.length} tracks`,
        artwork: a.artwork,
        bgColor: null,
        showPortrait: true,
        primaryAction: { label: 'Play' },
        secondaryAction: null,
      },
      tracks: { title: 'Tracks', items: data.tracks },
      rail: { title: '', items: [] },
    });
  }

  async function loadPlaylist(playlistId, player) {
    cancelFeaturedRotation();
    if (!catalog.getPlaylistFull) {
      return renderLockedView(
        player,
        'Playlist',
        'Playlist',
        'Connect Spotify to load your real playlists.',
      );
    }
    const data = await catalog.getPlaylistFull(playlistId);
    const p = data.playlist;
    player.setView({
      page: { crumb: 'Playlist', title: p.name },
      hero: {
        label: 'Playlist',
        title: p.name,
        subtitle: `${p.owner} · ${p.trackCount} tracks`,
        artwork: p.artwork,
        bgColor: null,
        showPortrait: true,
        primaryAction: { label: 'Play' },
        secondaryAction: null,
      },
      tracks: { title: 'Tracks', items: data.tracks },
      rail: { title: '', items: [] },
    });
  }

  async function loadBrowse(player) {
    cancelFeaturedRotation();
    const albums = await catalog.fetchNewReleases(24);
    player.setView({
      page: { crumb: 'Listen Now', title: 'Browse' },
      hero: {
        label: 'New & Notable',
        title: 'New Releases',
        subtitle: 'Top albums this week',
        artwork: null,
        bgColor: null,
        showPortrait: false,
        primaryAction: null,
        secondaryAction: null,
      },
      tracks: null,
      rail: {
        title: 'New this week',
        variant: 'album',
        items: albums,
        onItemClick: (album) => navigate(() => loadAlbum(album.id, player)),
      },
    });
  }

  async function loadRadio(player) {
    cancelFeaturedRotation();
    const tracks = await catalog.fetchTopTracks(20);
    const subtitle = catalog.fetchUserProfile
      ? 'Your most-played tracks in the past 4 weeks'
      : 'Top tracks on Apple Music right now';
    player.setView({
      page: { crumb: 'Listen Now', title: 'Radio' },
      hero: {
        label: 'Personal Mix',
        title: catalog.fetchUserProfile ? 'Your Top Tracks' : 'Trending Now',
        subtitle,
        artwork: null,
        bgColor: null,
        showPortrait: false,
        primaryAction: { label: 'Play' },
        secondaryAction: null,
      },
      tracks: { title: 'Top tracks', items: tracks },
      rail: { title: '', items: [] },
    });
  }

  async function loadRecentlyAdded(player) {
    cancelFeaturedRotation();
    if (!catalog.fetchSavedTracks) {
      return renderLockedView(
        player,
        'Library',
        'Recently Added',
        'Connect Spotify to see your saved tracks.',
      );
    }
    const tracks = await catalog.fetchSavedTracks(30);
    player.setView({
      page: { crumb: 'Library', title: 'Recently Added' },
      hero: {
        label: 'Library',
        title: 'Recently Added',
        subtitle: `${tracks.length} saved tracks`,
        artwork: null, bgColor: null, showPortrait: false,
        primaryAction: { label: 'Play' }, secondaryAction: null,
      },
      tracks: { title: 'Saved tracks', items: tracks },
      rail: { title: '', items: [] },
    });
  }

  async function loadSongs(player) {
    cancelFeaturedRotation();
    if (!catalog.fetchSavedTracks) {
      return renderLockedView(
        player,
        'Library',
        'Songs',
        'Connect Spotify to see your saved tracks.',
      );
    }
    const tracks = await catalog.fetchSavedTracks(30);
    player.setView({
      page: { crumb: 'Library', title: 'Songs' },
      hero: {
        label: 'Library',
        title: 'Songs',
        subtitle: `${tracks.length} saved tracks`,
        artwork: null, bgColor: null, showPortrait: false,
        primaryAction: { label: 'Play' }, secondaryAction: null,
      },
      tracks: { title: 'All tracks', items: tracks },
      rail: { title: '', items: [] },
    });
  }

  async function loadLibraryAlbums(player) {
    cancelFeaturedRotation();
    if (!catalog.fetchSavedAlbums) {
      return renderLockedView(
        player,
        'Library',
        'Albums',
        'Connect Spotify to see your saved albums.',
      );
    }
    const albums = await catalog.fetchSavedAlbums(30);
    player.setView({
      page: { crumb: 'Library', title: 'Albums' },
      hero: {
        label: 'Library',
        title: 'Albums',
        subtitle: `${albums.length} saved albums`,
        artwork: null, bgColor: null, showPortrait: false,
        primaryAction: null, secondaryAction: null,
      },
      tracks: null,
      rail: {
        title: 'Your albums',
        variant: 'album',
        items: albums,
        onItemClick: (album) => navigate(() => loadAlbum(album.id, player)),
      },
    });
  }

  async function loadLibraryArtists(player) {
    cancelFeaturedRotation();
    if (!catalog.fetchFollowedArtists) {
      return renderLockedView(
        player,
        'Library',
        'Artists',
        'Connect Spotify to see the artists you follow.',
      );
    }
    const artists = await catalog.fetchFollowedArtists(30);
    const items = artists.map((a) => ({
      id: a.id,
      name: a.name,
      artwork: a.artwork,
      subtitle: a.genres || `${a.followers.toLocaleString()} followers`,
    }));
    player.setView({
      page: { crumb: 'Library', title: 'Artists' },
      hero: {
        label: 'Library',
        title: 'Artists',
        subtitle: `${artists.length} followed artists`,
        artwork: null, bgColor: null, showPortrait: false,
        primaryAction: null, secondaryAction: null,
      },
      tracks: null,
      rail: {
        title: 'Your artists',
        variant: 'artist',
        items,
        onItemClick: (artist) => navigate(() => loadArtist(artist.id, player)),
      },
    });
  }

  // ── Public surface ─────────────────────────────────────────────────────

  return {
    forYou: loadForYou,
    artist: loadArtist,
    album: loadAlbum,
    playlist: loadPlaylist,
    byView: {
      'for-you': loadForYou,
      'browse': loadBrowse,
      'radio': loadRadio,
      'recently-added': loadRecentlyAdded,
      'songs': loadSongs,
      'albums': loadLibraryAlbums,
      'artists': loadLibraryArtists,
    },
  };
}
