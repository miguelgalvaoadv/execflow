import type { NextConfig } from "next";

/**
 * Proxy reverso: todas as chamadas /api/** são encaminhadas para o API server (porta 3001).
 *
 * RAZÃO: os cookies do Better Auth têm SameSite=Lax.
 * Quando o browser faz fetch de localhost:3000 → localhost:3001 (cross-origin por porta),
 * o browser NÃO envia cookies de terceiros, causando 401 em todas as rotas autenticadas.
 *
 * Com o proxy, o browser chama localhost:3000/api/** (mesma origem),
 * o cookie vai junto, e o Next.js repassa a requisição completa para localhost:3001.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

