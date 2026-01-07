import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "KEEPCLICKING - Tap to Earn Solana Rewards",
  description: "Click to earn points by tapping and earn SOL rewards. Join clicking sessions, compete on the leaderboard, and get paid in Solana every 15 minutes.",
  keywords: ["Solana", "clicking", "crypto", "tap to earn", "SOL", "rewards", "blockchain", "web3"],
  authors: [{ name: "KEEPCLICKING" }],
  creator: "KEEPCLICKING",
  publisher: "KEEPCLICKING",

  // Open Graph
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://keepclicking.app",
    siteName: "KEEPCLICKING",
    title: "KEEPCLICKING - Tap to Earn Solana Rewards",
    description: "Click to earn points by tapping and earn SOL rewards. Join clicking sessions, compete on the leaderboard, and get paid in Solana every 15 minutes.",
    images: [
      {
        url: "/logo.jpg",
        width: 512,
        height: 512,
        alt: "KEEPCLICKING Logo",
      },
    ],
  },

  // Twitter Card
  twitter: {
    card: "summary_large_image",
    title: "KEEPCLICKING - Tap to Earn Solana Rewards",
    description: "Click to earn points by tapping and earn SOL rewards. Join clicking sessions and get paid every 15 minutes.",
    images: ["/logo.jpg"],
    creator: "@keepclicking",
  },

  // Icons
  icons: {
    icon: "/logo.jpg",
    shortcut: "/logo.jpg",
    apple: "/logo.jpg",
  },

  // Theme
  themeColor: "#ff8c00",
  colorScheme: "dark",

  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },

  // Viewport
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
