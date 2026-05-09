import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Spotify's OAuth rejects `http://localhost` redirect URIs since 2025;
  // they require either HTTPS or `http://127.0.0.1`. Binding to 127.0.0.1
  // makes Vite print and open the matching URL by default.
  server: { host: '127.0.0.1', port: 5173, open: true },
});
