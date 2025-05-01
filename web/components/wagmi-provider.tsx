"use client"

import { useEffect, useState, useRef } from "react"
import type React from "react"
import { WagmiConfig, createConfig } from "wagmi"
import { chains } from "@/lib/chain-utils"
import { ConnectKitProvider, getDefaultConfig } from "connectkit"
import { http } from "wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { base } from "viem/chains"

export function WagmiProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const queryClientRef = useRef<QueryClient>()
  const wagmiConfigRef = useRef<any>()

  // Initialize QueryClient and Wagmi config only once
  if (!queryClientRef.current) {
    queryClientRef.current = new QueryClient()
  }

  // Set up the config only once on the client side
  useEffect(() => {
    if (!wagmiConfigRef.current && typeof window !== "undefined") {
      // Create the config
      const appUrl = window.location.origin

      const config = createConfig(
        getDefaultConfig({
          // Your dApp's info
          appName: "Ethereum Trading Agent",
          // Required API Keys
          walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
          // Required chains - use our chain utilities
          chains: [chains.base, chains.ethereum, chains.baseSepolia],
          transports: {
            [chains.ethereum.id]: http(),
            [chains.base.id]: http(),
            [chains.baseSepolia.id]: http(),
          },
          // Optional parameters
          appDescription: "AI-powered trading assistant for Ethereum and Base",
          appUrl: appUrl,
          appIcon: `${appUrl}/favicon.ico`,
          // Disable Family accounts as per documentation
          enableFamily: false,
        }),
      )

      wagmiConfigRef.current = config
      setMounted(true)
    }
  }, [])

  // Handle the case where we're rendering on the server
  if (!mounted) {
    // Return a minimal tree that doesn't use any hooks that depend on wagmi
    return (
      <QueryClientProvider client={queryClientRef.current}>
        <div style={{ visibility: "hidden" }}>{children}</div>
      </QueryClientProvider>
    )
  }

  // Client-side rendering with everything initialized
  return (
    <QueryClientProvider client={queryClientRef.current}>
      <WagmiConfig config={wagmiConfigRef.current}>
        <ConnectKitProvider
          theme="midnight"
          options={{
            hideNoWalletCTA: true,
            hideRecentBadge: true,
            walletConnectCTA: "scan",
            disableSiweRedirect: true,
            initialChainId: base.id,
            bufferPollingMs: 2000,
            persistConnectionWithLocalStorage: true,
          }}
          customTheme={{
            "--ck-connectbutton-font-size": "15px",
            "--ck-connectbutton-color": "#ffffff",
            "--ck-connectbutton-background": "transparent",
            "--ck-connectbutton-hover-background": "rgba(255, 255, 255, 0.1)",
            "--ck-connectbutton-active-background": "rgba(255, 255, 255, 0.05)",
          }}
        >
          {children}
        </ConnectKitProvider>
      </WagmiConfig>
    </QueryClientProvider>
  )
}
