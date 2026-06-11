import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Проверка накладной",
  description: "Система проверки товаров по накладной",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="h-full">
      <body className="min-h-full bg-gray-100 antialiased">
        <header className="bg-slate-900 text-white shadow-lg print:hidden">
          <div className="max-w-3xl mx-auto px-6 pt-4 flex items-center gap-3">
            <span className="text-2xl">📦</span>
            <h1 className="text-lg font-semibold tracking-wide">Проверка накладной</h1>
          </div>
          <Nav />
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
