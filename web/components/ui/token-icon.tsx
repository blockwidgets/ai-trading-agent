"use client"

import { useState } from "react"
import { getTokenLogo } from "@/lib/token-service"

interface TokenIconProps {
  symbol: string
  logo?: string
  size?: "sm" | "md" | "lg"
  className?: string
}

export function TokenIcon({ symbol, logo, size = "md", className = "" }: TokenIconProps) {
  const [imageError, setImageError] = useState(false)

  const sizeClass = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  }[size]

  const logoUrl = !imageError ? logo || getTokenLogo({ symbol, logo }) : null

  if (!logoUrl || imageError) {
    // Fallback to symbol initial
    return (
      <div
        className={`${sizeClass} rounded-full bg-primary/20 flex items-center justify-center text-xs ${className}`}
        title={symbol}
      >
        {symbol?.charAt(0) || "?"}
      </div>
    )
  }

  return (
    <img
      src={logoUrl || "/placeholder.svg"}
      alt={symbol}
      className={`${sizeClass} rounded-full ${className}`}
      onError={() => setImageError(true)}
      title={symbol}
    />
  )
}
