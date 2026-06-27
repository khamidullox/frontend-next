import type { Metadata, Viewport } from "next";
import { Fjalla_One } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import AuthProvider from "@/components/AuthProvider";
import LanguageProvider from "@/lib/i18n";

// Шрифт для цены на ценниках.
const fjalla = Fjalla_One({ weight: "400", subsets: ["latin"], variable: "--font-fjalla" });

export const metadata: Metadata = {
  title: "TaminotWeb",
  description: "Система проверки товаров по накладной",
  appleWebApp: {
    capable: true,
    title: "TaminotWeb",
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
    <html lang="ru" className={`h-full ${fjalla.variable}`}>
      <body className="min-h-full bg-gray-100 antialiased">
        <AuthProvider>
          <LanguageProvider>
            <AppShell>{children}</AppShell>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
