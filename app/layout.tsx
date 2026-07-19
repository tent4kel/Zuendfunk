import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit"
});

export const metadata: Metadata = {
  title: "Zündfunk Direkt",
  description: "Die neuesten Zündfunk-Sendungen direkt abspielen."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className={outfit.variable}>{children}</body>
    </html>
  );
}
