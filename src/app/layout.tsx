import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pano360Align — 360° Horizon Correction",
  description: "Correct the horizon alignment of 360° equirectangular images and video. For static, tripod-mounted 360° cameras.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
