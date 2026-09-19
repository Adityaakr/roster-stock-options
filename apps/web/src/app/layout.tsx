import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
// The wallet modal ships its own stylesheet for the mechanics (overlay, centring, fade); globals.css restyles it in the design tokens.
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { Providers } from "@/components/providers";

const display = Space_Grotesk({ variable: "--font-display", subsets: ["latin"], weight: ["400", "500"] });
const sans = Inter({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Roster Finance", template: "%s · Roster Finance" },
  description: "Stock leverage without margin liquidation. Fully paid contracts on NVDAx, on Solana: choose an expiry, see the premium and break-even, know the maximum loss before you buy."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
