import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Foodies — Coming Soon",
  description:
    "We're cooking up an amazing experience for you. Stay tuned and get ready for something great!",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f5f0",
};

export default function ComingSoonLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="coming-soon-root h-dvh w-full overflow-hidden bg-[#f5f5f0]">
      {children}
    </div>
  );
}
