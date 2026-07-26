import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: fileURLToPath(new URL("./kin-design-demo.html", import.meta.url)),
    },
  },
});
