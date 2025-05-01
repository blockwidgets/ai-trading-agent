import { createClient } from "@/lib/supabase/client"
import { fetchWalletTokensWithAlchemy } from "@/lib/alchemy-service"
import { fetchWalletTokensWithMoralis } from "@/lib/moralis-service"
import { SUPPORTED_CHAIN_IDS, getChainName } from "@/lib/chain-utils"
import { formatLargeNumber } from "@/lib/token-service"

// Define types for portfolio data
export interface TokenBalance {
  tokenAddress: string
  symbol: string
  name: string
  balance: string
  decimals: number
  priceUsd: string
  balanceUsd: number
  chainId: number
  chainName: string
  logo?: string
  tokenType?: string
  priceChange24h?: number
  percentOfPortfolio?: number
}

// Cache for portfolio data
interface PortfolioCache {
  [walletAddress: string]: {
    data: TokenBalance[]
    timestamp: number
  }
}

// Cache portfolio data for 5 minutes
const PORTFOLIO_CACHE_TTL = 5 * 60 * 1000
const portfolioCache: PortfolioCache = {}

// Enable ETH, BASE, and BASE SEPOLIA chains
const ENABLED_CHAINS = SUPPORTED_CHAIN_IDS

/**
 * Fetch wallet token balances across multiple chains
 * Uses either Moralis or Alchemy API based on configuration
 */
export async function fetchWalletTokens(walletAddress: string, forceRefresh = false): Promise<TokenBalance[]> {
  try {
    console.log(`Fetching wallet tokens for ${walletAddress}, forceRefresh: ${forceRefresh}`)

    // Check cache first if not forcing refresh
    if (!forceRefresh) {
      const cachedData = getCachedPortfolio(walletAddress)
      if (cachedData) {
        console.log(`Using cached portfolio data for ${walletAddress}`)
        return cachedData
      }
    }

    // Check if we have API keys configured
    const moralisApiKey = process.env.MORALIS_API_KEY
    const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY

    if (!moralisApiKey && !alchemyApiKey) {
      console.error("No API keys configured for Moralis or Alchemy")
      throw new Error("No API keys configured. Please set up Moralis or Alchemy API keys.")
    }

    // Determine which API to use based on environment variable
    // Default to Moralis if not specified
    const useAlchemy = process.env.NEXT_PUBLIC_USE_ALCHEMY_API === "true" && alchemyApiKey
    console.log(`Using ${useAlchemy ? "Alchemy" : "Moralis"} API for fetching wallet tokens`)

    let portfolioData: TokenBalance[] = []

    try {
      if (useAlchemy) {
        // Use Alchemy API
        portfolioData = await fetchWalletTokensWithAlchemy(walletAddress)
      } else {
        // Use Moralis API
        portfolioData = await fetchWalletTokensWithMoralis(walletAddress)
      }
    } catch (error) {
      console.error("Error fetching portfolio data from API:", error)
      throw new Error("Failed to fetch portfolio data. Please try again later.")
    }

    console.log(`Fetched ${portfolioData.length} tokens before filtering`)

    // If no tokens were found, return empty array
    if (portfolioData.length === 0) {
      console.log("No tokens found in wallet")
      return []
    }

    // Filter for only enabled chains
    portfolioData = portfolioData.filter((token) => ENABLED_CHAINS.includes(token.chainId))
    console.log(`${portfolioData.length} tokens after chain filtering`)

    // Filter out tokens with zero or very low value
    portfolioData = portfolioData.filter((token) => token.balanceUsd > 0.001)
    console.log(`${portfolioData.length} tokens after value filtering`)

    // If no tokens remain after filtering, return empty array
    if (portfolioData.length === 0) {
      console.log("No significant token balances found after filtering")
      return []
    }

    // Calculate total portfolio value
    const totalValue = portfolioData.reduce((sum, token) => sum + token.balanceUsd, 0)
    console.log(`Total portfolio value: $${totalValue.toFixed(2)}`)

    // Calculate percentage of portfolio for each token
    portfolioData.forEach((token) => {
      token.percentOfPortfolio = (token.balanceUsd / totalValue) * 100
    })

    // Sort by USD value (descending)
    portfolioData.sort((a, b) => b.balanceUsd - a.balanceUsd)

    // Cache the result
    cachePortfolio(walletAddress, portfolioData)

    // Store the portfolio data in Supabase for the user
    try {
      await storePortfolioData(walletAddress, portfolioData)
    } catch (error) {
      console.error("Error storing portfolio data:", error)
    }

    return portfolioData
  } catch (error) {
    console.error("Error fetching portfolio data:", error)
    throw error
  }
}

/**
 * Get cached portfolio data or null if not cached or expired
 */
function getCachedPortfolio(walletAddress: string): TokenBalance[] | null {
  const cacheKey = walletAddress.toLowerCase()
  const cachedData = portfolioCache[cacheKey]

  if (cachedData && Date.now() - cachedData.timestamp < PORTFOLIO_CACHE_TTL) {
    return cachedData.data
  }

  // Also check localStorage for persistence across page refreshes
  try {
    const localStorageKey = `portfolio_${cacheKey}`
    const localData = localStorage.getItem(localStorageKey)

    if (localData) {
      const { data, timestamp } = JSON.parse(localData)
      if (Date.now() - timestamp < PORTFOLIO_CACHE_TTL) {
        // Update memory cache
        portfolioCache[cacheKey] = { data, timestamp }
        return data
      }
    }
  } catch (error) {
    console.warn("Error accessing localStorage:", error)
  }

  return null
}

/**
 * Cache portfolio data
 */
function cachePortfolio(walletAddress: string, data: TokenBalance[]): void {
  const cacheKey = walletAddress.toLowerCase()
  const timestamp = Date.now()

  // Update memory cache
  portfolioCache[cacheKey] = { data, timestamp }

  // Update localStorage cache
  try {
    localStorage.setItem(`portfolio_${cacheKey}`, JSON.stringify({ data, timestamp }))
    console.log(`Cached portfolio data for ${walletAddress}`)
  } catch (error) {
    console.warn("Error writing to localStorage:", error)
  }
}

/**
 * Store portfolio data in Supabase
 */
async function storePortfolioData(walletAddress: string, portfolioData: TokenBalance[]) {
  try {
    const supabase = createClient()

    // Get user ID from wallet address
    const { data: userData } = await supabase.from("users").select("id").eq("wallet_address", walletAddress).single()

    if (!userData) return

    // Delete existing portfolio data for this user
    await supabase.from("portfolio_transactions").delete().eq("user_id", userData.id).eq("transaction_type", "balance")

    // Insert new portfolio data
    const transactions = portfolioData.map((token) => ({
      user_id: userData.id,
      token_address: token.tokenAddress,
      token_symbol: token.symbol,
      token_name: token.name,
      amount: token.balance,
      price_usd: token.priceUsd,
      transaction_type: "balance",
      chain_id: token.chainId,
      transaction_hash: null,
    }))

    if (transactions.length > 0) {
      await supabase.from("portfolio_transactions").insert(transactions)
      console.log(`Stored ${transactions.length} portfolio transactions in Supabase`)
    }
  } catch (error) {
    console.error("Error storing portfolio data:", error)
  }
}

/**
 * Get portfolio summary for AI context
 */
export function getPortfolioSummary(portfolioData: TokenBalance[]): string {
  if (!portfolioData || portfolioData.length === 0) {
    return "No portfolio data available."
  }

  // Calculate total portfolio value
  const totalValue = portfolioData.reduce((sum, token) => sum + token.balanceUsd, 0)

  // Group tokens by chain
  const chainGroups: Record<string, TokenBalance[]> = {}
  portfolioData.forEach((token) => {
    token.chainName = getChainName(token.chainId)
    if (!chainGroups[token.chainName]) {
      chainGroups[token.chainName] = []
    }
    chainGroups[token.chainName].push(token)
  })

  // Create summary text
  let summary = `Total Portfolio Value: ${formatLargeNumber(totalValue)}\n\n`

  // Add top holdings
  summary += "Holdings:\n"
  portfolioData.forEach((token) => {
    const percentage = token.percentOfPortfolio?.toFixed(1) || "0.0"
    summary += `- ${token.symbol} (${token.chainName}): ${formatLargeNumber(token.balanceUsd)} (${percentage}%)\n`
  })

  // Add chain breakdown
  summary += "\nHoldings by Chain:\n"
  Object.entries(chainGroups).forEach(([chainName, tokens]) => {
    const chainValue = tokens.reduce((sum, token) => sum + token.balanceUsd, 0)
    const percentage = ((chainValue / totalValue) * 100).toFixed(1)
    summary += `- ${chainName}: ${formatLargeNumber(chainValue)} (${percentage}%)\n`
  })

  return summary
}
