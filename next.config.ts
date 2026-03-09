import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 🌟 1. ไม้ตาย: หลอก Vercel ให้ข้ามไฟล์ C++ แล้วไปใช้ WASM แทน เพื่อรัน AI
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node$": false, 
    };
    return config;
  },

  // 🌐 2. ตั้งค่า CORS ให้แอป Flutter และหน้าเว็บเรียกใช้งานได้จากทุกที่
  async headers() {
    return [
      {
        source: "/api/:path*", 
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" }, 
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ]
      }
    ]
  }
};

export default nextConfig;