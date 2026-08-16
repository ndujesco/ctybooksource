import type { Metadata, Viewport } from "next";
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import TabBar from "@/components/TabBar";
import "./globals.css";

// Display: a text serif, because the subject is books.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Body / UI.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Every figure in the app — tabular, so ledger columns align.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CTY Booksource",
  description: "Invoices, customers and sales records for a book wholesaler.",
};

export const viewport: Viewport = {
  themeColor: "#faf9f6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

// Apply the saved font scale before first paint so text never jumps.
const NO_FLASH = `try{var s=localStorage.getItem("pb.fontScale");if(s)document.documentElement.style.setProperty("--font-scale",s)}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body
        className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable} antialiased`}
      >
        <div className="sheet pb-24">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
