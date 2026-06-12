import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppHeader from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "Проверка накладной",
  description: "Система проверки товаров по накладной",
  appleWebApp: {
    capable: true,
    title: "Накладная",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="h-full">
      <body className="min-h-full bg-gray-100 antialiased">
        <AppHeader />
        <main className="max-w-3xl mx-auto px-4 py-4">
          {children}
        </main>
      </body>
    </html>
  );
}
