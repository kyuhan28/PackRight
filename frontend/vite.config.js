import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // GitHub Codespaces opens the app on an *.app.github.dev address.
    allowedHosts: [".app.github.dev"],
    // Send API calls to Flask so the browser only ever talks to one address,
    // which keeps the login cookie working without any CORS setup.
    proxy: { "/api": "http://127.0.0.1:5000" },
  },
});
