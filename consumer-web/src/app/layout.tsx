import type { Metadata } from "next";
// import { Geist, Geist_Mono } from "next/font/google";
// import { Inter, Geist_Mono } from "next/font/google";
// import { Poppins, Geist_Mono } from "next/font/google";
// import { Manrope, Geist_Mono } from "next/font/google";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
// import { Outfit, Geist_Mono } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { Providers } from "@/components/providers";
import { RouteTransition } from "@/components/route-transition";

// const geistSans = Geist({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
// });
// const inter = Inter({
//   variable: "--font-geist-sans", // keep same variable name
//   subsets: ["latin"],
// });
// const poppins = Poppins({
//   variable: "--font-geist-sans", // keep this the same
//   subsets: ["latin"],
//   weight: ["300", "400", "500", "600", "700"], // important for Poppins
// });
// const manrope = Manrope({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
//   weight: ["300", "400", "500", "600", "700"],
// });
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});
// const outfit = Outfit({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
//   weight: ["300", "400", "500", "600", "700"],
// });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Foodies — Browse the menu",
  description:
    "Find a branch, explore brands and menus, then order through our mobile app.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // <html
    //   lang="en"
    //   className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    //   data-theme="light"
    // >
    
    //Inter Fonts
    // <html
    //   lang="en"
    //   className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    //   data-theme="light"
    // >
    //Poppins Fonts
    // <html
    //   lang="en"
    //   className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
    //   data-theme="light"
    // >
    
    <html
      lang="en"
      className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}
      data-theme="light"
    >
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)]">
        <Providers>
          <RouteTransition>{children}</RouteTransition>
        </Providers>
      </body>
    </html>
  );
}
