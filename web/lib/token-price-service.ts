import { getTokenInfoByTicker as getMoralisTokenInfo, type TokenInfo, initializeMoralis } from "@/lib/moralis-service"
import { createClient } from "@/lib/supabase/client"
import Moralis from "moralis"
import { EvmChain } from "@moralisweb3/common-evm-utils"
import { getChainById } from "@/lib/chain-utils"

// Cache for token prices
interface PriceCache {
  [key: string]: {
    price: number
    priceChange24h: number
    marketCap: number
    volume24h: number
    timestamp: number
  }
}

// Wrapped ETH addresses for each chain
const wrappedEthAddresses: Record<number, string> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH on Ethereum
  8453: "0x4200000000000000000000000000000000000006", // WETH on Base
  84532: "0x4200000000000000000000000000000000000006", // WETH on Base Sepolia
}

// Chain ID mapping for Moralis API - using EvmChain enum
const chains = {
  ethereum: getChainById(1),
  base: getChainById(8453),
  baseSepolia: getChainById(84532),
}

const chainIdToMoralisChain: Record<number, any> = {
  [chains.ethereum.id]: EvmChain.ETHEREUM, // Ethereum Mainnet
  [chains.base.id]: EvmChain.BASE, // Base
  [chains.baseSepolia.id]: EvmChain.BASE_SEPOLIA, // Base Sepolia
}

// Cache prices for 15 minutes
const PRICE_CACHE_TTL = 15 * 60 * 1000
const priceCache: PriceCache = {}

/**
 * Get cached price or null if not cached or expired
 */
function getCachedPrice(
  tokenSymbol: string,
  chainId: number,
): { price: number; priceChange24h: number; marketCap: number; volume24h: number } | null {
  const cacheKey = `${chainId}:${tokenSymbol.toLowerCase()}`
  const cachedData = priceCache[cacheKey]

  if (cachedData && Date.now() - cachedData.timestamp < PRICE_CACHE_TTL) {
    return {
      price: cachedData.price,
      priceChange24h: cachedData.priceChange24h,
      marketCap: cachedData.marketCap,
      volume24h: cachedData.volume24h,
    }
  }

  return null
}

/**
 * Cache a token price
 */
function cachePrice(
  tokenSymbol: string,
  chainId: number,
  price: number,
  priceChange24h: number,
  marketCap: number,
  volume24h: number,
): void {
  const cacheKey = `${chainId}:${tokenSymbol.toLowerCase()}`
  priceCache[cacheKey] = {
    price,
    priceChange24h,
    marketCap,
    volume24h,
    timestamp: Date.now(),
  }
}

/**
 * Helper function to delay execution
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetch with retry logic and rate limiting
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, backoff = 500): Promise<Response> {
  try {
    const response = await fetch(url, options)

    // If we hit a rate limit, wait longer and retry
    if (response.status === 429 && retries > 0) {
      console.warn(`Rate limit hit, retrying after ${backoff}ms...`)
      await delay(backoff)
      return fetchWithRetry(url, options, retries - 1, backoff * 2)
    }

    return response
  } catch (error) {
    if (retries > 0) {
      console.warn(`Fetch failed, retrying after ${backoff}ms...`, error)
      await delay(backoff)
      return fetchWithRetry(url, options, retries - 1, backoff * 2)
    }
    throw error
  }
}

/**
 * Map chain ID to CoinGecko platform ID
 */
function chainIdToCoinGeckoPlatform(chainId: number): string {
  const platformMap: Record<number, string> = {
    1: "ethereum",
    8453: "base",
    84532: "base", // Use "base" for Base Sepolia as CoinGecko might not have a specific endpoint
  }
  return platformMap[chainId] || "ethereum"
}

/**
 * Map chain ID to CoinGecko coin ID for native tokens
 */
function chainIdToCoinGeckoCoin(chainId: number): string {
  const coinMap: Record<number, string> = {
    1: "ethereum",
    8453: "ethereum", // Base uses ETH
    84532: "ethereum", // Base Sepolia uses ETH
  }
  return coinMap[chainId] || "ethereum"
}

/**
 * Get token info from Supabase token_metadata table
 */
async function getTokenInfoFromSupabase(tokenSymbol: string, chainId: number): Promise<TokenInfo | null> {
  try {
    const supabase = createClient()

    // Normalize symbol for case-insensitive search
    const normalizedSymbol = tokenSymbol.toUpperCase()

    const { data, error } = await supabase
      .from("token_metadata")
      .select("*")
      .eq("chain_id", chainId)
      .ilike("ticker", normalizedSymbol)
      .limit(1)

    if (error) {
      console.error("Error fetching token info from database:", error)
      throw new Error(`Database error when fetching token info: ${error.message}`)
    }

    if (!data || data.length === 0) {
      throw new Error(`Token ${normalizedSymbol} not found in Supabase database for chain ID ${chainId}`)
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
    }

    return tokenInfo
  } catch (error) {
    console.error("Error in getTokenInfoFromSupabase:", error)
    throw error
  }
}

/**
 * Fetch market data for a token using Moralis
 */
async function fetchTokenMarketData(tokenInfo: TokenInfo): Promise<TokenInfo> {
  try {
    // Check if we already have price data
    if (tokenInfo.price > 0) {
      return tokenInfo
    }

    // Initialize Moralis if not already initialized
    const initialized = await initializeMoralis()
    if (!initialized) {
      console.warn("Failed to initialize Moralis, returning token info without market data")
      return tokenInfo
    }

    // Get the chain for price lookup
    const moralisChain = chainIdToMoralisChain[tokenInfo.chainId]
    if (!moralisChain) {
      console.warn(`No Moralis chain mapping for chain ID ${tokenInfo.chainId}`)
      return tokenInfo
    }

    // Get token price data
    try {
      const priceResponse = await Moralis.EvmApi.token.getTokenPrice({
        chain: moralisChain,
        address: tokenInfo.contractAddress,
      })

      if (priceResponse.raw) {
        tokenInfo.price = priceResponse.raw.usdPrice || 0
        tokenInfo.marketCap = priceResponse.raw.usdMarketCap || 0
        tokenInfo.volume24h = priceResponse.raw.usdVolume24h || 0
      }

      // If market cap or volume is missing, try to get it from CoinGecko
      if (!tokenInfo.marketCap || !tokenInfo.volume24h) {
        try {
          const platformId = chainIdToCoinGeckoPlatform(tokenInfo.chainId)
          const coinGeckoResponse = await fetch(
            `https://api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${tokenInfo.contractAddress}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`,
            { headers: { Accept: "application/json" } },
          )

          if (coinGeckoResponse.ok) {
            const data = await coinGeckoResponse.json()
            const tokenData = data[tokenInfo.contractAddress.toLowerCase()]
            if (tokenData) {
              // Only update if we don't already have the data
              if (!tokenInfo.marketCap) tokenInfo.marketCap = tokenData.usd_market_cap || 0
              if (!tokenInfo.volume24h) tokenInfo.volume24h = tokenData.usd_24h_vol || 0
              if (!tokenInfo.priceChange24h) tokenInfo.priceChange24h = tokenData.usd_24h_change || 0
            }
          }
        } catch (error) {
          console.warn(`Failed to fetch additional market data from CoinGecko:`, error)
        }
      }
    } catch (error) {
      console.warn(`Error fetching price data for ${tokenInfo.symbol}:`, error)
      // Continue with price = 0
    }

    return tokenInfo
  } catch (error) {
    console.error("Error fetching token market data:", error)
    return tokenInfo
  }
}

/**
 * Get token info by ticker symbol
 * This function first checks Supabase for token metadata, then enriches it with market data from Moralis
 */
export async function getTokenInfoByTicker(ticker: string, chainId?: number): Promise<TokenInfo | null> {
  try {
    // Normalize ticker
    const normalizedTicker = ticker.toUpperCase()

    // Check cache first if chainId is provided
    if (chainId) {
      const cacheKey = `${chainId}:${normalizedTicker}`
      const cachedPrice = getCachedPrice(normalizedTicker, chainId)
      if (cachedPrice) {
        // If we have cached price data, we can construct a basic TokenInfo
        // This is a simplified approach - in a real app, you might want to cache the full TokenInfo
        console.log(`Using cached price data for ${normalizedTicker} on chain ${chainId}`)
        return {
          symbol: normalizedTicker,
          price: cachedPrice.price,
          priceChange24h: cachedPrice.priceChange24h,
          marketCap: cachedPrice.marketCap,
          volume24h: cachedPrice.volume24h,
          contractAddress: "", // We don't have this in the cache
          chain: "", // We don't have this in the cache
          chainId: chainId,
        }
      }
    }

    // First check our Supabase database if chainId is provided
    if (chainId) {
      try {
        const supabaseTokenInfo = await getTokenInfoFromSupabase(normalizedTicker, chainId)
        if (supabaseTokenInfo) {
          console.log(`Found token ${normalizedTicker} in Supabase database for chain ${chainId}`)

          // Enrich with market data from Moralis
          const enrichedTokenInfo = await fetchTokenMarketData(supabaseTokenInfo)

          // Cache the price data
          if (enrichedTokenInfo.price > 0) {
            cachePrice(
              normalizedTicker,
              chainId,
              enrichedTokenInfo.price,
              enrichedTokenInfo.priceChange24h || 0,
              enrichedTokenInfo.marketCap || 0,
              enrichedTokenInfo.volume24h || 0,
            )
          }

          return enrichedTokenInfo
        }
      } catch (error) {
        console.warn(`Error fetching token from Supabase, falling back to Moralis:`, error)
        // Continue to Moralis implementation
      }
    }

    // If not found in Supabase or no chainId provided, use the Moralis implementation
    const moralisTokenInfo = await getMoralisTokenInfo(normalizedTicker, chainId)

    // Cache the price data if we got a result
    if (moralisTokenInfo && moralisTokenInfo.price > 0 && chainId) {
      cachePrice(
        normalizedTicker,
        chainId,
        moralisTokenInfo.price,
        moralisTokenInfo.priceChange24h || 0,
        moralisTokenInfo.marketCap || 0,
        moralisTokenInfo.volume24h || 0,
      )
    }

    return moralisTokenInfo
  } catch (error) {
    console.error("Error in getTokenInfoByTicker:", error)
    return null
  }
}
