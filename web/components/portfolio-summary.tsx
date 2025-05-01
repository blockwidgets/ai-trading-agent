"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { fetchWalletTokens } from "@/lib/portfolio-service"
import { PortfolioTable } from "@/components/portfolio-table"
import { PortfolioDistributionChart } from "@/components/portfolio-distribution-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { RefreshCw, AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useToast } from "@/components/ui/use-toast"

interface PortfolioSummaryProps {
  walletAddress: string | undefined
  userId: string | null
}

export function PortfolioSummary({ walletAddress, userId }: PortfolioSummaryProps) {
  const [loading, setLoading] = useState(true)
  const [portfolioData, setPortfolioData] = useState<any[]>([])
  const [portfolioValue, setPortfolioValue] = useState<number>(0)
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const { toast } = useToast()
  const supabase = createClient()

  // Load portfolio data with caching
  const loadPortfolioData = useCallback(
    async (forceRefresh = false) => {
      if (!walletAddress) return

      setLoading(true)
      setError(null)

      try {
        console.log(`Loading portfolio data for ${walletAddress}, force refresh: ${forceRefresh}`)

        // Fetch fresh data from API
        const data = await fetchWalletTokens(walletAddress, forceRefresh)

        setPortfolioData(data)
        setLastRefresh(new Date())

        // Calculate total portfolio value
        const totalValue = data.reduce((sum, token) => sum + (token.balanceUsd || 0), 0)
        setPortfolioValue(totalValue)

        // Set the first token as selected by default if available
        if (data.length > 0 && !selectedToken) {
          setSelectedToken(data[0].tokenAddress)
        }
      } catch (error: any) {
        console.error("Error loading portfolio data:", error)
        setError(error.message || "Failed to load portfolio data. API rate limit may have been exceeded.")
        toast({
          variant: "destructive",
          title: "Portfolio Error",
          description: "Failed to load portfolio data.",
          duration: 5000,
        })
      } finally {
        setLoading(false)
      }
    },
    [walletAddress, selectedToken, toast],
  )

  // Initial load
  useEffect(() => {
    if (walletAddress) {
      loadPortfolioData(false)
    }
  }, [walletAddress, loadPortfolioData])

  // Format the last refresh time
  const formatLastRefresh = () => {
    if (!lastRefresh) return "Never"

    const now = new Date()
    const diff = Math.floor((now.getTime() - lastRefresh.getTime()) / 1000) // seconds

    if (diff < 60) return `${diff} seconds ago`
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
    return lastRefresh.toLocaleString()
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Portfolio</h1>
          <p className="text-muted-foreground">
            {lastRefresh ? `Last updated: ${formatLastRefresh()}` : "Loading portfolio data..."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadPortfolioData(true)}
          disabled={loading}
          className="flex items-center gap-1"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!loading && portfolioData.length === 0 ? (
        <Alert variant="warning" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Portfolio Data</AlertTitle>
          <AlertDescription>
            No tokens found in this wallet. Please connect a wallet with tokens or switch to a different network.
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-[200px] w-full rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
          </div>
          <Skeleton className="h-[300px] w-full rounded-lg" />
        </div>
      ) : portfolioData.length > 0 ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Total Value</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  $
                  {portfolioValue.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Assets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{portfolioData.length}</div>
              </CardContent>
            </Card>
          </div>

          {/* Add the new portfolio distribution chart */}
          <PortfolioDistributionChart data={portfolioData} />

          <PortfolioTable
            data={portfolioData}
            onSelectToken={(tokenAddress) => setSelectedToken(tokenAddress)}
            selectedToken={selectedToken}
          />
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No portfolio data found</p>
          <p className="text-sm mt-2">Connect your wallet and make sure you have tokens on supported chains</p>
        </div>
      )}
    </div>
  )
}
