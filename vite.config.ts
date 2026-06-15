import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  optimizeDeps: {
    include: [
      "@monaco-editor/react",
      "@uiw/react-md-editor/nohighlight",
      "react-icons/fi",
      "sonner",
    ],
  },
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    noExternal: ["@uiw/react-md-editor", "@uiw/react-markdown-preview"],
  },
});
