/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // react-leaflet typings vs Next 14 — build prod Vercel
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
