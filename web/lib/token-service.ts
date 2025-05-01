/**
 * Shared token service for token information, prices, and formatting
 */
import { getChainById } from "@/lib/chain-utils"
import { createClient } from "@/lib/supabase/client"

// Token information interface
export interface TokenInfo {
  symbol: string
  name?: string
  contractAddress: string
  decimals: number
  price: number
  priceChange24h?: number
  marketCap?: number
  volume24h?: number
  chain: string
  chainId: number
  logo?: string
  links?: {
    website?: string[]
    explorer?: string[]
    twitter?: string[]
    reddit?: string[]
    telegram?: string[]
    discord?: string[]
    github?: string[]
  }
}

// Cache for token info
interface TokenInfoCache {
  [key: string]: {
    data: TokenInfo
    timestamp: number
  }
}

// Cache token info for 15 minutes
const TOKEN_INFO_CACHE_TTL = 15 * 60 * 1000
const tokenInfoCache: TokenInfoCache = {}

/**
 * Get cached token info or null if not cached or expired
 */
export function getCachedTokenInfo(tokenSymbol: string, chainId?: number): TokenInfo | null {
  const cacheKey = chainId ? `${chainId}:${tokenSymbol.toLowerCase()}` : tokenSymbol.toLowerCase()
  const cachedInfo = tokenInfoCache[cacheKey]

  if (cachedInfo && Date.now() - cachedInfo.timestamp < TOKEN_INFO_CACHE_TTL) {
    return cachedInfo.data
  }

  return null
}

/**
 * Cache token info
 */
export function cacheTokenInfo(tokenInfo: TokenInfo): void {
  const cacheKey = `${tokenInfo.chainId}:${tokenInfo.symbol.toLowerCase()}`
  tokenInfoCache[cacheKey] = {
    data: tokenInfo,
    timestamp: Date.now(),
  }
}

/**
 * Get token info from Supabase token_metadata table
 */
export async function getTokenInfoFromSupabase(ticker: string, chainId?: number): Promise<TokenInfo | null> {
  try {
    const supabase = createClient()
    let query = supabase.from("token_metadata").select("*")

    // Normalize ticker for case-insensitive search
    const normalizedTicker = ticker.toUpperCase()

    // Filter by ticker (case insensitive)
    query = query.ilike("ticker", normalizedTicker)

    // Filter by chain_id if provided
    if (chainId) {
      query = query.eq("chain_id", chainId)
    }

    const { data, error } = await query.limit(1)

    if (error) {
      console.error("Error fetching token info from Supabase:", error)
      return null
    }

    if (!data || data.length === 0) {
      return null
    }

    const tokenData = data[0]

    // Convert to TokenInfo format
    const tokenInfo: TokenInfo = {
      symbol: tokenData.ticker,
      name: tokenData.token_name,
      price: 0, // We'll need to fetch price separately
      contractAddress: tokenData.contract_address,
      chain: tokenData.chain_name,
      chainId: tokenData.chain_id,
      logo: tokenData.image,
      decimals: tokenData.decimals || 18,
    }

    return tokenInfo
  } catch (error) {
    console.error("Error in getTokenInfoFromSupabase:", error)
    return null
  }
}

/**
 * Format a token amount with proper decimals
 * @param amount The amount to format
 * @param decimals The number of decimals
 * @returns Formatted amount as a string
 */
export function formatTokenAmount(amount: string | number, decimals: number): string {
  try {
    const amountStr = typeof amount === "number" ? amount.toString() : amount

    if (amountStr.includes(".")) {
      const [whole, fraction] = amountStr.split(".")
      const wholeNum = whole === "" || whole === "0" ? "0" : whole
      const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals)
      const result = wholeNum + paddedFraction
      return wholeNum === "0" ? result : result.replace(/^0+/, "")
    } else {
      const result = amountStr + "0".repeat(decimals)
      return amountStr === "0" ? result : result.replace(/^0+/, "")
    }
  } catch (error) {
    console.error("Error formatting token amount:", error)
    return "0"
  }
}

/**
 * Format a big integer with decimals for human-readable display
 * @param amount The amount as a bigint or string
 * @param decimals The number of decimals
 * @returns Formatted amount as a string
 */
export function formatBigIntWithDecimals(amount: bigint | string, decimals: number): string {
  try {
    const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount
    const amountStr = amountBigInt.toString()

    if (amountStr.length <= decimals) {
      return "0." + amountStr.padStart(decimals, "0")
    }

    const decimalPosition = amountStr.length - decimals
    const wholePart = amountStr.substring(0, decimalPosition)
    const fractionPart = amountStr.substring(decimalPosition)
    const trimmedFractionPart = fractionPart.replace(/0+$/, "")

    if (trimmedFractionPart === "") {
      return wholePart
    }

    return `${wholePart}.${trimmedFractionPart}`
  } catch (error) {
    console.error("Error formatting bigint with decimals:", error)
    return "0"
  }
}

/**
 * Format a number for display with proper units (B for billions, M for millions, etc.)
 * @param num The number to format
 * @returns Formatted number as a string
 */
export function formatLargeNumber(num: number | undefined): string {
  if (num === undefined || num === 0) return "$0"
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`
  return `$${num.toLocaleString()}`
}

/**
 * Map chain ID to CoinGecko platform ID
 */
export function chainIdToCoinGeckoPlatform(chainId: number): string | null {
  const platformMap: Record<number, string> = {
    1: "ethereum",
    8453: "base",
    84532: "base", // Use "base" for Base Sepolia as CoinGecko might not have a specific endpoint
  }
  return platformMap[chainId] || null
}

/**
 * Map chain ID to CoinGecko coin ID for native tokens
 */
export function chainIdToCoinGeckoCoin(chainId: number): string | null {
  const coinMap: Record<number, string> = {
    1: "ethereum",
    8453: "ethereum", // Base uses ETH
    84532: "ethereum", // Base Sepolia uses ETH
  }
  return coinMap[chainId] || null
}

/**
 * Get native token info for a chain
 */
export function getNativeTokenInfo(chainId: number): { symbol: string; name: string; decimals: number } {
  const chain = getChainById(chainId)
  return {
    symbol: chain.nativeCurrency.symbol,
    name: chain.nativeCurrency.name,
    decimals: chain.nativeCurrency.decimals,
  }
}

/**
 * Get token logo URL or fallback
 */
export function getTokenLogo(token: { symbol: string; logo?: string }): string | null {
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
