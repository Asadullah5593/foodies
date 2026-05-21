import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Foodies — Coming Soon",
  description:
    "We're cooking up an amazing experience for you. Stay tuned and get ready for something great!",
  robots: { index: true, follow: true },
};

export default function ComingSoonLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="h-dvh w-full overflow-hidden bg-[#f5f5f0]">{children}</div>;
}
