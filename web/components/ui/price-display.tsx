"use client"

interface PriceDisplayProps {
  price: number | string
  change?: number
  currency?: string
  className?: string
  showChange?: boolean
}

export function PriceDisplay({
  price,
  change,
  currency = "USD",
  className = "",
  showChange = true,
}: PriceDisplayProps) {
  const numPrice = typeof price === "string" ? Number.parseFloat(price) : price
  const formattedPrice = numPrice.toLocaleString(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: numPrice < 1 ? 6 : 2,
  })

  const changeColor = !change ? "" : change > 0 ? "text-green-500" : "text-red-500"
  const changePrefix = !change ? "" : change > 0 ? "+" : ""
  const changeText = !change ? "" : `${changePrefix}${change.toFixed(2)}%`

  return (
    <div className={`${className}`}>
      <span className="font-mono">{formattedPrice}</span>
      {showChange && change !== undefined && <span className={`ml-2 text-sm ${changeColor}`}>{changeText}</span>}
    </div>
  )
}
