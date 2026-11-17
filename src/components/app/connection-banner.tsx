"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { WifiOffIcon } from "lucide-react";

/**
 * Shows a clear banner when the clinic server cannot be reached (Wi-Fi down,
 * server off). Nothing is saved while offline: the app never queues patient,
 * clinical or financial writes on the device (offline policy, §27).
 */
export function ConnectionBanner() {
  const t = useTranslations("offline");
  const [down, setDown] = useState(false);

  useEffect(() => {
    let failures = 0;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
        failures = res.ok ? 0 : failures + 1;
      } catch {
        failures += 1;
      } finally {
        clearTimeout(timer);
      }
      if (!stopped) setDown(failures >= 2);
    };
    const onOffline = () => setDown(true);
    const onOnline = () => void check();
    const id = setInterval(check, 15_000);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onOnline);
    return () => {
      stopped = true;
      clearInterval(id);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onOnline);
    };
  }, []);

  if (!down) return null;
  return (
    <div role="alert" className="sticky top-0 z-40 flex items-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-white no-print">
      <WifiOffIcon className="size-4 shrink-0" aria-hidden />
      <span>{t("banner")}</span>
    </div>
  );
}
