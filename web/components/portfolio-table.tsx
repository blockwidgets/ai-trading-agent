"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { TokenIcon } from "@/components/ui/token-icon"
import { TokenAmount } from "@/components/ui/token-amount"
import { PriceDisplay } from "@/components/ui/price-display"
import { getChainName } from "@/lib/chain-utils"

interface PortfolioTableProps {
  data: any[]
  onSelectToken: (tokenAddress: string) => void
  selectedToken: string | null
  loading?: boolean
  error?: string | null
}

export function PortfolioTable({ data, onSelectToken, selectedToken, loading, error }: PortfolioTableProps) {
  // Ensure data is valid
  const validData = Array.isArray(data) ? data : []

  // Function to get token logo or fallback
  const getTokenLogo = (token: any) => {
    // Special case for ETH
    if (token.symbol === "ETH") {
      return "https://assets.coingecko.com/coins/images/279/small/ethereum.png"
    }

    // Special case for WETH
    if (token.symbol === "WETH") {
      return "https://assets.coingecko.com/coins/images/2518/small/weth.png"
    }

    // Special case for USDC
    if (token.symbol === "USDC") {
      return "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png"
    }

    // Special case for DAI
    if (token.symbol === "DAI") {
      return "https://assets.coingecko.com/coins/images/9956/small/4943.png"
    }

    // Special case for cbETH
    if (token.symbol === "cbETH") {
      return "https://assets.coingecko.com/coins/images/27008/small/cbeth.png"
    }

    // Use provided logo or fallback
    return token.logo || null
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 flex justify-between items-center">
          <h2 className="text-xl font-bold">Token Balances</h2>
        </div>
        {validData.length === 0 && !loading ? (
          <div className="text-center py-8">
            <p className="text-gray-500">
              No tokens found in this wallet. Please connect a wallet with tokens or switch to a different network.
            </p>
          </div>
        ) : null}
        {error ? (
          <div className="text-center py-8">
            <p className="text-red-500">{error}</p>
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-muted/50">
              <TableHead>Token</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">% of Portfolio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {validData.map((token, index) => (
              <TableRow
                key={index}
                className={`hover:bg-muted/50 cursor-pointer ${selectedToken === token.tokenAddress ? "bg-muted/50" : ""}`}
                onClick={() => onSelectToken(token.tokenAddress)}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <TokenIcon symbol={token.symbol} logo={token.logo} size="sm" />
                    {token.symbol || "Unknown"}
                  </div>
                </TableCell>
                <TableCell>{getChainName(token.chainId, token.chainName)}</TableCell>
                <TableCell className="text-right font-mono">
                  <TokenAmount
                    amount={token.balance}
                    decimals={token.decimals}
                    showSymbol={false}
                    minDecimals={2}
                    maxDecimals={6}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <PriceDisplay price={token.priceUsd} showChange={false} />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <PriceDisplay price={token.balanceUsd} showChange={false} />
                </TableCell>
                <TableCell className="text-right font-mono">
                  {token.percentOfPortfolio?.toFixed(2) || "0.00"}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
