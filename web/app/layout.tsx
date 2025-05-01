import type React from "react"
import { Inter } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { WagmiProvider } from "@/components/wagmi-provider"
import "@/app/globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "AI Trading Agent",
  description: "AI-powered trading assistant for Ethereum and Base"
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <WagmiProvider>
            {children}
            <Toaster />
          </WagmiProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
