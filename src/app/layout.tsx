import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ServiceWorkerRegistration } from "@/components/app/service-worker";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { directionOf, isLocale } from "@/i18n/config";
import "./globals.css";

// Fonts are bundled in the repository (SIL Open Font License) so the app builds
// and runs with no internet access on a clinic server.
const latin = localFont({
  variable: "--font-latin",
  display: "swap",
  src: [
    { path: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/inter-latin-ext-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
});
const arabic = localFont({
  variable: "--font-arabic",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2", weight: "700", style: "normal" },
  ],
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
            <ServiceWorkerRegistration />
            <Toaster position={dir === "rtl" ? "top-left" : "top-right"} richColors closeButton />
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
