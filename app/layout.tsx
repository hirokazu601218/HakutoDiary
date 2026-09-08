import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "珀翔diary",
  description: "保育園での珀翔の毎日を、家族で振り返る日記",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "珀翔diary", statusBarStyle: "default" },
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#eff8ff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
