import "server-only";

import QRCode from "qrcode";

/** QR code as an inline SVG string (vector: sharp on any poster size, no network, no image file). */
export async function qrSvg(text: string, opts: { color?: string } = {}): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: opts.color ?? "#000000", light: "#ffffff" },
  });
}
