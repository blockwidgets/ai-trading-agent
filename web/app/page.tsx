import dynamic from "next/dynamic"
import { LoadingFallback } from "@/components/loading-fallback"

// Use dynamic import with SSR disabled to avoid hydration issues with wallet connection
const TradingAgent = dynamic(() => import("@/components/trading-agent").then((mod) => mod.TradingAgent), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <TradingAgent />
    </main>
  )
}
