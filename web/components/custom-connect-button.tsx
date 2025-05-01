"use client"

import { ConnectKitButton } from "connectkit"
import { Button } from "@/components/ui/button"
import { Wallet, Loader2 } from "lucide-react"
import { useAccount } from "wagmi"

export function CustomConnectButton() {
  const { isConnecting } = useAccount()

  return (
    <ConnectKitButton.Custom>
      {({ isConnected, isConnecting: ckIsConnecting, show, hide, address, ensName }) => {
        // Use either the ConnectKit isConnecting or the wagmi isConnecting
        const connecting = isConnecting || ckIsConnecting

        return (
          <Button
            variant="outline"
            size="sm"
            className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            onClick={show}
            disabled={connecting}
          >
            {connecting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : isConnected ? (
              <>
                <Wallet className="h-4 w-4 mr-2" />
                {ensName ?? `${address?.slice(0, 6)}...${address?.slice(-4)}`}
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4 mr-2" />
                Connect Wallet
              </>
            )}
          </Button>
        )
      }}
    </ConnectKitButton.Custom>
  )
}
