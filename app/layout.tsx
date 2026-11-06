import type { Metadata, Viewport } from "next";
import { Anton, Archivo, Creepster, Instrument_Sans, Pirata_One, Rozha_One } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });
const rozha = Rozha_One({ subsets: ["latin"], weight: "400", variable: "--font-rozha" });
const creepster = Creepster({ subsets: ["latin"], weight: "400", variable: "--font-creepster" });
const pirata = Pirata_One({ subsets: ["latin"], weight: "400", variable: "--font-pirata" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton" });

export const metadata: Metadata = {
  title: "blindshot",
  description: "A digital disposable camera for your party. No app, just your phone: it runs in your browser.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable} ${rozha.variable} ${creepster.variable} ${pirata.variable} ${anton.variable}`}>
      <body>{children}</body>
    </html>
  );
}
