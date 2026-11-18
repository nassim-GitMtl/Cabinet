"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CameraIcon, CameraOffIcon, PackageMinusIcon, PackagePlusIcon, ScanBarcodeIcon, UnlinkIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { initialActionState } from "@/lib/action-state";
import { consumeInventoryAction, deactivateInventoryIdentifierAction, receiveInventoryAction, registerInventoryIdentifierAction } from "../actions";
import { inventoryIdentifierFormats } from "../schemas";
import { parseInventoryScan } from "../scan";

type Item = { id: string; sku: string; name: string; stock: number; unit: string };
type Branch = { id: string; label: string };
type Identifier = { id: string; itemId: string; code: string; format: string; itemName: string; sku: string };
type DetectedBarcode = { rawValue: string; format?: string };
type BarcodeDetectorInstance = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

function detectorFormat(format?: string): typeof inventoryIdentifierFormats[number] {
  if (format === "ean_13") return "ean13";
  if (format === "code_128") return "code128";
  if (format === "qr_code" || format === "data_matrix") return "qr";
  return "other";
}

function DeactivateIdentifier({ identifierId }: { identifierId: string }) {
  const t = useTranslations("inventory.scan");
  const [state, action] = useActionState(deactivateInventoryIdentifierAction, initialActionState);
  return (
    <form action={action}>
      <input type="hidden" name="identifierId" value={identifierId} />
      <FormError error={state.error} />
      <SubmitButton variant="ghost" size="sm" aria-label={t("deactivate")}><UnlinkIcon aria-hidden />{t("deactivate")}</SubmitButton>
    </form>
  );
}

function QuickReceipt({ item, branches, today, lotNumber, expiresOn }: { item: Item; branches: Branch[]; today: string; lotNumber: string | null; expiresOn: string | null }) {
  const t = useTranslations("inventory");
  const [state, action] = useActionState(receiveInventoryAction, initialActionState);
  return (
    <details className="rounded-xl border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden"><PackagePlusIcon className="size-4" aria-hidden />{t("scan.quickReceipt")}</summary>
      <form action={action} className="grid gap-3 border-t p-3 sm:grid-cols-2">
        <input type="hidden" name="itemId" value={item.id} />
        <div className="sm:col-span-2"><FormError error={state.error} /></div>
        <SelectField name="branchId" label={t("branch")} required options={branches.map((branch) => ({ value: branch.id, label: branch.label }))} placeholder={t("chooseBranch")} defaultValue={state.values?.branchId} error={state.fieldErrors?.branchId} />
        <TextField name="quantity" type="number" min="1" step="1" label={t("quantity")} required defaultValue={state.values?.quantity ?? "1"} error={state.fieldErrors?.quantity} />
        <TextField name="lotNumber" label={t("lotNumber")} required defaultValue={state.values?.lotNumber ?? lotNumber ?? ""} error={state.fieldErrors?.lotNumber} dir="auto" />
        <TextField name="expiresOn" type="date" label={t("expiresOn")} optionalLabel defaultValue={state.values?.expiresOn ?? expiresOn ?? ""} error={state.fieldErrors?.expiresOn} />
        <TextField name="receivedOn" type="date" max={today} label={t("receivedOn")} required defaultValue={state.values?.receivedOn ?? today} error={state.fieldErrors?.receivedOn} />
        <TextField name="reference" label={t("reference")} optionalLabel defaultValue={state.values?.reference} error={state.fieldErrors?.reference} dir="auto" />
        <div className="sm:col-span-2"><SubmitButton>{t("recordReceipt")}</SubmitButton></div>
      </form>
    </details>
  );
}

function QuickConsumption({ item, branches }: { item: Item; branches: Branch[] }) {
  const t = useTranslations("inventory");
  const [state, action] = useActionState(consumeInventoryAction, initialActionState);
  return (
    <details className="rounded-xl border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden"><PackageMinusIcon className="size-4" aria-hidden />{t("scan.quickConsumption")}</summary>
      <form action={action} className="grid gap-3 border-t p-3 sm:grid-cols-2">
        <input type="hidden" name="itemId" value={item.id} />
        <div className="sm:col-span-2"><FormError error={state.error} /></div>
        <SelectField name="branchId" label={t("branch")} required options={branches.map((branch) => ({ value: branch.id, label: branch.label }))} placeholder={t("chooseBranch")} defaultValue={state.values?.branchId} error={state.fieldErrors?.branchId} />
        <TextField name="quantity" type="number" min="1" step="1" label={t("quantity")} required defaultValue={state.values?.quantity ?? "1"} error={state.fieldErrors?.quantity} />
        <div className="sm:col-span-2"><TextField name="reference" label={t("usageReference")} optionalLabel defaultValue={state.values?.reference} error={state.fieldErrors?.reference} dir="auto" /></div>
        <div className="sm:col-span-2"><SubmitButton>{t("recordUsage")}</SubmitButton></div>
      </form>
    </details>
  );
}

export function InventoryScanner({ items, branches, identifiers, today }: { items: Item[]; branches: Branch[]; identifiers: Identifier[]; today: string }) {
  const t = useTranslations("inventory");
  const [raw, setRaw] = useState("");
  const [format, setFormat] = useState<typeof inventoryIdentifierFormats[number]>("other");
  const [registerItemId, setRegisterItemId] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [registerState, registerAction] = useActionState(registerInventoryIdentifierAction, initialActionState);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRunRef = useRef(0);
  const parsed = useMemo(() => parseInventoryScan(raw), [raw]);
  const identifier = identifiers.find((row) => row.code === parsed.productCode || row.code === parsed.raw);
  const item = items.find((row) => row.id === identifier?.itemId);

  useEffect(() => () => {
    cameraRunRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopCamera() {
    cameraRunRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  async function startCamera() {
    setCameraError(null);
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("inventory.scan.cameraUnavailable");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      const run = ++cameraRunRef.current;
      const detector = new Detector({ formats: ["qr_code", "data_matrix", "ean_13", "code_128"] });
      const detect = async () => {
        if (run !== cameraRunRef.current || !videoRef.current) return;
        try {
          const results = await detector.detect(videoRef.current);
          if (results[0]?.rawValue) {
            setRaw(results[0].rawValue);
            setFormat(detectorFormat(results[0].format));
            stopCamera();
            return;
          }
          window.setTimeout(() => void detect(), 180);
        } catch {
          stopCamera();
          setCameraError("inventory.scan.cameraDenied");
        }
      };
      void detect();
    } catch {
      stopCamera();
      setCameraError("inventory.scan.cameraDenied");
    }
  }

  const itemOptions = items.map((row) => ({ value: row.id, label: `${row.sku} · ${row.name}` }));
  const formatOptions = inventoryIdentifierFormats.map((value) => ({ value, label: t(`scan.formats.${value}`) }));

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border bg-card shadow-sm" aria-labelledby="inventory-scan-title">
      <div className="border-b p-4">
        <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><ScanBarcodeIcon aria-hidden /></span><div><h2 id="inventory-scan-title" className="font-semibold">{t("scan.title")}</h2><p className="text-sm text-muted-foreground">{t("scan.hint")}</p></div></div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <TextField name="scan" label={t("scan.code")} hideLabel fieldClassName="flex-1" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={t("scan.placeholder")} autoComplete="off" autoCapitalize="off" spellCheck={false} dir="ltr" />
          {cameraActive ? <Button type="button" variant="outline" onClick={stopCamera}><CameraOffIcon aria-hidden />{t("scan.stopCamera")}</Button> : <Button type="button" variant="outline" onClick={() => void startCamera()}><CameraIcon aria-hidden />{t("scan.openCamera")}</Button>}
        </div>
        {cameraError ? <p className="mt-2 text-sm text-destructive">{t(cameraError.replace("inventory.", ""))}</p> : null}
      </div>
      <video ref={videoRef} className={cameraActive ? "aspect-video max-h-72 w-full bg-black object-cover" : "hidden"} muted playsInline aria-label={t("scan.cameraPreview")} />

      {raw.trim() ? (
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-muted/20 p-4">
            {item ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold"><bdi>{item.name}</bdi></p><p className="text-xs text-muted-foreground"><bdi>{item.sku}</bdi> · <bdi>{identifier!.code}</bdi></p></div><Badge variant="secondary">{t("scan.recognized")}</Badge></div>
                <p className="mt-3 text-2xl font-semibold tabular-nums">{item.stock} <span className="text-sm font-normal text-muted-foreground">{t(`units.${item.unit}`)}</span></p>
                {parsed.gs1 ? <div className="mt-3 grid gap-1 rounded-lg bg-background p-3 text-sm"><p>{t("scan.gtin")}: <bdi>{parsed.productCode}</bdi></p><p>{t("lotNumber")}: <bdi>{parsed.lotNumber ?? "—"}</bdi></p><p>{t("expiresOn")}: {parsed.expiresOn ?? "—"}</p></div> : null}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3"><p className="font-semibold">{t("scan.unknown")}</p><Badge variant="outline">{parsed.gs1 ? "GS1" : t(`scan.formats.${format}`)}</Badge></div>
                <p className="mt-1 break-all text-sm text-muted-foreground" dir="ltr">{parsed.productCode}</p>
                {parsed.gs1 ? <div className="mt-3 grid gap-1 rounded-lg bg-background p-3 text-sm"><p>{t("scan.gtin")}: <bdi>{parsed.productCode}</bdi></p><p>{t("lotNumber")}: <bdi>{parsed.lotNumber ?? "—"}</bdi></p><p>{t("expiresOn")}: {parsed.expiresOn ?? "—"}</p></div> : null}
                <form action={registerAction} className="mt-4 grid gap-3">
                  <FormError error={registerState.error} />
                  <input type="hidden" name="code" value={parsed.productCode} />
                  <SelectField name="itemId" label={t("scan.assignItem")} required options={itemOptions} placeholder={t("chooseItem")} value={registerItemId} onChange={(event) => setRegisterItemId(event.target.value)} error={registerState.fieldErrors?.itemId} />
                  <SelectField name="format" label={t("scan.format")} required options={formatOptions} value={parsed.gs1 ? "gtin" : format} onChange={(event) => setFormat(event.target.value as typeof format)} error={registerState.fieldErrors?.format} />
                  <SubmitButton disabled={!items.length}>{t("scan.register")}</SubmitButton>
                </form>
              </>
            )}
          </div>
          {item ? <div className="grid content-start gap-3" key={`${item.id}:${parsed.raw}`}><QuickReceipt item={item} branches={branches} today={today} lotNumber={parsed.lotNumber} expiresOn={parsed.expiresOn} /><QuickConsumption item={item} branches={branches} /></div> : <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{t("scan.unknownHint")}</div>}
        </div>
      ) : <p className="p-6 text-center text-sm text-muted-foreground">{t("scan.empty")}</p>}

      {identifiers.length ? <details className="border-t"><summary className="cursor-pointer list-none p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">{t("scan.registered", { count: identifiers.length })}</summary><ul className="divide-y border-t">{identifiers.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="font-medium"><bdi>{row.itemName}</bdi> <span className="text-muted-foreground">· <bdi>{row.sku}</bdi></span></p><p className="break-all text-xs text-muted-foreground" dir="ltr">{row.code} · {t(`scan.formats.${row.format}`)}</p></div><DeactivateIdentifier identifierId={row.id} /></li>)}</ul></details> : null}
    </section>
  );
}
