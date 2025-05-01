"use client"

import { formatBigIntWithDecimals } from "@/lib/token-service"

interface TokenAmountProps {
  amount: string | number | bigint
  decimals?: number
  symbol?: string
  showSymbol?: boolean
  className?: string
  maxDecimals?: number
  minDecimals?: number
}

export function TokenAmount({
  amount,
  decimals = 18,
  symbol,
  showSymbol = true,
  className = "",
  maxDecimals = 6,
  minDecimals = 2,
}: TokenAmountProps) {
  let formattedAmount: string

  if (typeof amount === "bigint") {
    formattedAmount = formatBigIntWithDecimals(amount, decimals)
  } else {
    const numAmount = typeof amount === "string" ? Number.parseFloat(amount) : amount
    formattedAmount = numAmount.toLocaleString(undefined, {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
    })
  }

  return (
    <span className={`font-mono ${className}`}>
      {formattedAmount}
      {showSymbol && symbol && ` ${symbol}`}
    </span>
  )
}
