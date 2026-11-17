import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { directionOf, isLocale } from "@/i18n/config";
import "./globals.css";

const latin = Inter({ variable: "--font-latin", subsets: ["latin", "latin-ext"], display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: "Gestion de cabinet dentaire",
    manifest: "/manifest.webmanifest",
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: t("appName"), statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: "#0f7f86",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const dir = isLocale(locale) ? directionOf(locale) : "ltr";
  return (
    <html lang={locale} dir={dir} className={`${latin.variable} ${arabic.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        <NextIntlClientProvider>
          <TooltipProvider>
            {children}
            <Toaster position={dir === "rtl" ? "top-left" : "top-right"} richColors closeButton />
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
