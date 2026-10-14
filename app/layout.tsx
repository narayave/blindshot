import type { Metadata, Viewport } from "next";
import { Archivo, Instrument_Sans, Rozha_One } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });
const rozha = Rozha_One({ subsets: ["latin"], weight: "400", variable: "--font-rozha" });

export const metadata: Metadata = {
  title: "blindshot",
  description: "a disposable camera for your party",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable} ${rozha.variable}`}>
      <body>{children}</body>
    </html>
  );
}
