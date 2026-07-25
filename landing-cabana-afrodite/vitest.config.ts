import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    // fuso fixo nos testes para validar a lógica America/Sao_Paulo
    env: { TZ: "America/Sao_Paulo" },
  },
});
