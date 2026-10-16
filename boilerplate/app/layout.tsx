import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FLUX — 3D Automation Canvas",
  description: "Boilerplate: React Three Fiber workflow canvas with two connected nodes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
