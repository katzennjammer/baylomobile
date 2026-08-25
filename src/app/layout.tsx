import type { Metadata } from "next"
import "./globals.css"
import Providers from "@/components/Providers"
import ConditionalShell from "@/components/ConditionalShell"

export const metadata: Metadata = {
  title: "Baylo — Trade What You Have",
  description:
    "A peer-to-peer bartering marketplace for Urban Cebu. List items, find trades, swap directly — no cash needed.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-direction="day" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,300..900;1,62..125,300..900&family=Cormorant+Garamond:wght@400;500;600&family=Playfair+Display:ital,wght@1,700&display=swap"
        />
      </head>
      <body data-motion="on">
        <Providers>
          <ConditionalShell>{children}</ConditionalShell>
        </Providers>
      </body>
    </html>
  )
}
