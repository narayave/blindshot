import { headers } from "next/headers";
import QRCode from "qrcode";

// The guest link for an event, and its QR code as SVG (black on white: it has to scan in a dark room).
export async function eventLink(code: string) {
  const h = await headers();
  const origin = process.env.SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const link = `${origin}/e/${code}`;
  return { link, qr: await QRCode.toString(link, { type: "svg", margin: 1 }) };
}
