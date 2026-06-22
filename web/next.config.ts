import type { NextConfig } from "next";

// next dev 时为 development，next build 时自动为 production
const isDev = process.env.NODE_ENV === "development";

// 开发模式：前端运行在 3000，通过 rewrites 代理到后端 8766
// 生产模式：next build 静态导出到 web/out/，由后端 8766 直接托管
const backend = process.env.GM_BACKEND || "http://127.0.0.1:8766";

const nextConfig: NextConfig = isDev
  ? {
      turbopack: { root: import.meta.dirname },
      async rewrites() {
        return [
          { source: "/api/:path*", destination: `${backend}/api/:path*` },
          { source: "/events",     destination: `${backend}/events`     },
          { source: "/login",      destination: `${backend}/login`      },
          { source: "/logout",     destination: `${backend}/logout`     },
          { source: "/me",         destination: `${backend}/me`         },
        ];
      },
    }
  : {
      output: "export",  // 生产：导出纯静态文件到 web/out/
      turbopack: { root: import.meta.dirname },
    };

export default nextConfig;
