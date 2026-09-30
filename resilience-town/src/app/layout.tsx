import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resilience Town",
  description: "3D command center for Resilience Enterprise's AI agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
