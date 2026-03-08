import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "path";
import chalk from "chalk";

// https://vite.dev/config/

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src/app"),
    },
  },
  server: {
    allowedHosts: ["assets.local"],
  },
  plugins: [
    react(),
    cloudflare(),
    {
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const timeString = new Date().toLocaleTimeString();
          console.log(
            `[${chalk.blue(timeString)}] ${chalk.green(
              req.method,
            )} ${chalk.yellow(req.url)}`,
          );
          next();
        });
      },
      name: "requestLogger",
    },
  ],
});
