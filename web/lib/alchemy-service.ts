import type { TokenBalance } from "@/lib/portfolio-service"
import { getChainName, SUPPORTED_CHAIN_IDS } from "@/lib/chain-utils"
import { respectRateLimit as baseRespectRateLimit, fetchWithRetry as baseFetchWithRetry } from "@/lib/api-client"
import {
  chainIdToCoinGeckoPlatform,
  chainIdToCoinGeckoCoin,
  getNativeTokenInfo as getChainNativeTokenInfo,
} from "@/lib/token-service"

// Chain ID to name mapping - use our chain utility
const chainIdToName: Record<number, string> = {}
SUPPORTED_CHAIN_IDS.forEach((chainId) => {
  chainIdToName[chainId] = getChainName(chainId)
})

// Chain ID to Alchemy network mapping
const chainIdToAlchemyNetwork: Record<number, string> = {
  1: "eth-mainnet",
  8453: "base-mainnet",
  84532: "base-sepolia",
}

// Supported chains - ETH, BASE, and BASE SEPOLIA
const supportedChains = SUPPORTED_CHAIN_IDS

// Price cache to reduce API calls
interface PriceCache {
  [key: string]: {
    price: number
    timestamp: number
    priceChange24h?: number
  }
}

// Cache prices for 15 minutes
const PRICE_CACHE_TTL = 15 * 60 * 1000
const priceCache: PriceCache = {}

// Global API rate limiting
const API_DELAY = 500 // Increased from 300ms to 500ms to be safer
const lastApiCall = 0
const lastCoinGeckoCall = 0 // Separate rate limiting for CoinGecko
const COINGECKO_DELAY = 1100 // CoinGecko has stricter rate limits (1 request per second)

/**
 * Helper function to delay execution
 */
const delay = async (ms: number) => await baseRespectRateLimit("alchemy", ms)

/**
 * Helper function to respect API rate limits
 * Returns the actual delay applied in ms
 */
async function respectRateLimit(): Promise<number> {
  return await baseRespectRateLimit("alchemy", API_DELAY)
}

/**
 * Helper function to respect CoinGecko rate limits
 */
async function respectCoinGeckoRateLimit(): Promise<number> {
  return await baseRespectRateLimit("coingecko", COINGECKO_DELAY)
}

/**
 * Get cached price or null if not cached or expired
 */
function getCachedPrice(tokenAddress: string, chainId: number): { price: number; priceChange24h?: number } | null {
  const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`
  const cachedData = priceCache[cacheKey]

  if (cachedData && Date.now() - cachedData.timestamp < PRICE_CACHE_TTL) {
    return {
      price: cachedData.price,
      priceChange24h: cachedData.priceChange24h,
    }
  }

  return null
}

/**
 * Cache a token price
 */
function cachePrice(tokenAddress: string, chainId: number, price: number, priceChange24h?: number): void {
  const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`
  priceCache[cacheKey] = {
    price,
    timestamp: Date.now(),
    priceChange24h,
  }
}

/**
 * Fetch with retry logic and rate limiting
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, backoff = 500): Promise<Response> {
  try {
    // Apply rate limiting before each request
    await respectRateLimit()

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
 * Fetch with retry logic specifically for CoinGecko
 */
async function fetchCoinGeckoWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  backoff = 1100,
): Promise<Response> {
  try {
    // Apply CoinGecko-specific rate limiting
    await respectCoinGeckoRateLimit()

    const response = await fetch(url, options)

    // If we hit a rate limit, wait longer and retry
    if (response.status === 429 && retries > 0) {
      console.warn(`CoinGecko rate limit hit, retrying after ${backoff}ms...`)
      await delay(backoff)
      return fetchCoinGeckoWithRetry(url, options, retries - 1, backoff * 2)
    }

    return response
  } catch (error) {
    if (retries > 0) {
      console.warn(`CoinGecko fetch failed, retrying after ${backoff}ms...`, error)
      await delay(backoff)
      return fetchCoinGeckoWithRetry(url, options, retries - 1, backoff * 2)
    }
    throw error
  }
}

/**
 * Fetch token prices from CoinGecko
 */
async function fetchTokenPrices(
  tokenAddresses: string[],
  chainId: number,
): Promise<Record<string, { usd: number; usd_24h_change?: number }>> {
  try {
    console.log(`Fetching prices for ${tokenAddresses.length} tokens on chain ${chainId}...`)

    // Map chain ID to CoinGecko platform ID
    const platformId = chainIdToCoinGeckoPlatform(chainId)
    if (!platformId) {
      return {}
    }

    // Check cache first for all tokens
    const cachedPrices: Record<string, { usd: number; usd_24h_change?: number }> = {}
    const tokensToFetch: string[] = []

    tokenAddresses.forEach((address) => {
      const cachedPrice = getCachedPrice(address, chainId)
      if (cachedPrice) {
        cachedPrices[address.toLowerCase()] = {
          usd: cachedPrice.price,
          usd_24h_change: cachedPrice.priceChange24h,
        }
      } else {
        tokensToFetch.push(address)
      }
    })

    // If all prices are cached, return them
    if (tokensToFetch.length === 0) {
      return cachedPrices
    }

    // Fetch prices from CoinGecko
    const contractAddresses = tokensToFetch.join(",")
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${contractAddresses}&vs_currencies=usd&include_24hr_change=true`

    const response = await fetchCoinGeckoWithRetry(url, {
      headers: {
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      console.warn(`Failed to fetch token prices: ${response.status}`)

      // If CoinGecko fails, try to fetch prices individually from Moralis
      const moralisApiKey = process.env.MORALIS_API_KEY || ""
      if (moralisApiKey) {
        const moralisPrices: Record<string, { usd: number; usd_24h_change?: number }> = {}

        for (const address of tokensToFetch) {
          try {
            console.log(`Fetching price for token ${address} from Moralis...`)

            // Apply rate limiting before each Moralis request
            await respectRateLimit()

            const chain = chainId === 1 ? "eth" : chainId === 8453 ? "base" : "base-sepolia"
            const url = `https://deep-index.moralis.io/api/v2/erc20/${address}/price?chain=${chain}&include=percent_change`
            const response = await fetchWithRetry(url, {
              headers: {
                accept: "application/json",
                "X-API-Key": moralisApiKey,
              },
            })

            if (response.ok) {
              const data = await response.json()
              const price = data.usdPrice || 0
              const priceChange = data.usdPriceFormatted?.["24HPercent"] || 0

              moralisPrices[address.toLowerCase()] = {
                usd: price,
                usd_24h_change: priceChange,
              }

              // Cache the price
              cachePrice(address, chainId, price, priceChange)
            }

            // Add extra delay between Moralis requests
            await delay(500)
          } catch (error) {
            console.error(`Error fetching price for token ${address} from Moralis:`, error)
          }
        }

        return { ...cachedPrices, ...moralisPrices }
      }

      return cachedPrices
    }

    const data = await response.json()

    // Cache the new prices
    Object.entries(data).forEach(([address, priceData]: [string, any]) => {
      const price = priceData.usd || 0
      const priceChange = priceData.usd_24h_change || 0
      cachePrice(address, chainId, price, priceChange)
    })

    // Combine cached and new prices
    return { ...cachedPrices, ...data }
  } catch (error) {
    console.error("Error fetching token prices:", error)
    return {}
  }
}

/**
 * Map chain ID to CoinGecko platform ID
 */
/**
 * Map chain ID to CoinGecko coin ID
 */
/**
 * Fetch native token price from CoinGecko
 */
async function fetchNativeTokenPrice(chainId: number): Promise<{ price: number; priceChange24h?: number }> {
  try {
    console.log(`Fetching native token price for chain ${chainId}...`)

    // Check cache first
    const cachedPrice = getCachedPrice("native", chainId)
    if (cachedPrice) {
      return cachedPrice
    }

    // Map chain ID to CoinGecko coin ID
    const coinId = chainIdToCoinGeckoCoin(chainId)
    if (!coinId) {
      return { price: 0 }
    }

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`

    const response = await fetchCoinGeckoWithRetry(url, {
      headers: {
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      console.warn(`Failed to fetch native token price: ${response.status}`)

      // If CoinGecko fails, try Moralis as a fallback
      const moralisApiKey = process.env.MORALIS_API_KEY || ""
      if (moralisApiKey) {
        try {
          console.log(`Trying Moralis fallback for native token price...`)

          // Apply rate limiting before Moralis request
          await respectRateLimit()

          const chain = chainId === 1 ? "eth" : chainId === 8453 ? "base" : "base-sepolia"
          const wrappedAddress =
            chainId === 1
              ? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" // WETH on Ethereum
              : "0x4200000000000000000000000000000000000006" // WETH on Base/Base Sepolia

          const url = `https://deep-index.moralis.io/api/v2/erc20/${wrappedAddress}/price?chain=${chain}&include=percent_change`
          const response = await fetchWithRetry(url, {
            headers: {
              accept: "application/json",
              "X-API-Key": moralisApiKey,
            },
          })

          if (response.ok) {
            const data = await response.json()
            const price = data.usdPrice || 3500 // Default to 3500 if price is 0
            const priceChange = data.usdPriceFormatted?.["24HPercent"] || 0

            // Cache the price
            cachePrice("native", chainId, price, priceChange)

            return { price, priceChange24h: priceChange }
          }
        } catch (error) {
          console.error(`Error fetching native token price from Moralis:`, error)
        }
      }

      // Default ETH price if all APIs fail
      return { price: 3500 }
    }

    const data = await response.json()
    const price = data[coinId]?.usd || 0
    const priceChange = data[coinId]?.usd_24h_change || 0

    // If price is still 0, use a default value
    const finalPrice = price > 0 ? price : 3500

    // Cache the price
    cachePrice("native", chainId, finalPrice, priceChange)

    return { price: finalPrice, priceChange24h: priceChange }
  } catch (error) {
    console.error(`Error fetching native token price for chain ${chainId}:`, error)
    return { price: 3500 } // Default ETH price if all else fails
  }
}

/**
 * Map chain ID to CoinGecko coin ID
 */
/**
 * Get native token info for a chain
 */
function getNativeTokenInfo(chainId: number): { symbol: string; name: string } {
  const nativeInfo = getChainNativeTokenInfo(chainId)
  return {
    symbol: nativeInfo.symbol,
    name: nativeInfo.name,
  }
}

/**
 * Fetch wallet token balances across multiple chains using Alchemy API
 */
export async function fetchWalletTokensWithAlchemy(walletAddress: string): Promise<TokenBalance[]> {
  try {
    const portfolioData: TokenBalance[] = []

    // Process chains strictly sequentially to avoid rate limits
    for (const chainId of supportedChains) {
      const network = chainIdToAlchemyNetwork[chainId]
      if (!network) continue

      try {
        console.log(`Fetching tokens for chain ${network} using Alchemy...`)

        // Skip Base Sepolia for now as Alchemy might not fully support it yet
        // We'll add mock data for it later
        if (chainId === 84532) {
          console.log("Skipping Base Sepolia in Alchemy API call, will add mock data later")
          continue
        }

        // Fetch token balances from Alchemy
        const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || ""
        if (!alchemyApiKey) {
          console.error("Alchemy API key not found")
          continue
        }

        // Use Alchemy's JSON-RPC API
        const url = `https://${network}.g.alchemy.com/v2/${alchemyApiKey}`

        // First, get token balances
        const tokenBalancesResponse = await baseFetchWithRetry(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "alchemy_getTokenBalances",
            params: [walletAddress],
          }),
        })

        if (!tokenBalancesResponse.ok) {
          console.warn(`Failed to fetch tokens for chain ${network}: ${tokenBalancesResponse.status}`)
          continue
        }

        const tokenBalancesData = await tokenBalancesResponse.json()

        // Filter out zero balances
        const tokenBalances = tokenBalancesData.result.tokenBalances.filter(
          (token: any) => token.tokenBalance !== "0" && token.tokenBalance !== "0x0",
        )

        if (tokenBalances.length === 0) {
          console.log(`No token balances found for chain ${network}`)
          // Still fetch native balance even if no ERC20 tokens
          await fetchNativeBalance(walletAddress, chainId, portfolioData)
          continue
        }

        // Get token metadata for all tokens
        const tokenAddresses = tokenBalances.map((token: any) => token.contractAddress)
        const tokenMetadata: Record<string, any> = {}

        // Fetch metadata for each token with rate limiting
        for (const tokenAddress of tokenAddresses) {
          console.log(`Fetching metadata for token ${tokenAddress}...`)

          const metadataResponse = await baseFetchWithRetry(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              id: 1,
              jsonrpc: "2.0",
              method: "alchemy_getTokenMetadata",
              params: [tokenAddress],
            }),
          })

          if (metadataResponse.ok) {
            const metadataData = await metadataResponse.json()
            tokenMetadata[tokenAddress] = metadataData.result
          }
        }

        // Fetch token prices with rate limiting
        console.log(`Fetching prices for ${tokenAddresses.length} tokens...`)
        const prices = await fetchTokenPrices(tokenAddresses, chainId)

        // Process token balances
        for (const token of tokenBalances) {
          const tokenAddress = token.contractAddress
          const metadata = tokenMetadata[tokenAddress]

          if (!metadata || !metadata.decimals) continue

          const decimals = Number.parseInt(metadata.decimals)
          const rawBalance = BigInt(token.tokenBalance)
          const balance = Number(rawBalance) / Math.pow(10, decimals)

          // Get price data
          const priceData = prices[tokenAddress.toLowerCase()]
          let price = priceData?.usd || 0
          const priceChange = priceData?.usd_24h_change || 0

          // If price is still 0, try to get a default price for common tokens
          if (price === 0) {
            if (metadata.symbol === "WETH" || metadata.symbol === "ETH") {
              price = 3500 // Default ETH price
            } else if (metadata.symbol === "WBTC" || metadata.symbol === "BTC") {
              price = 65000 // Default BTC price
            } else if (metadata.symbol === "USDC" || metadata.symbol === "USDT" || metadata.symbol === "DAI") {
              price = 1 // Default stablecoin price
            }
          }

          const balanceUsd = balance * price

          portfolioData.push({
            tokenAddress,
            symbol: metadata.symbol || "Unknown",
            name: metadata.name || "Unknown Token",
            balance: balance.toString(),
            decimals,
            priceUsd: price.toString(),
            balanceUsd,
            chainId,
            chainName: chainIdToName[chainId] || `Chain ${chainId}`,
            logo: metadata.logo || "",
            tokenType: "ERC20",
            priceChange24h: priceChange,
          })
        }

        // Fetch native token balance
        await fetchNativeBalance(walletAddress, chainId, portfolioData)

        // Add extra delay between chains to be extra safe
        await delay(1000)
      } catch (error) {
        console.error(`Error fetching tokens for chain ${network}:`, error)
      }
    }

    // Sort by USD value (descending)
    portfolioData.sort((a, b) => b.balanceUsd - a.balanceUsd)

    return portfolioData
  } catch (error) {
    console.error("Error fetching portfolio data with Alchemy:", error)
    throw error
  }
}

/**
 * Fetch native token balance
 */
async function fetchNativeBalance(
  walletAddress: string,
  chainId: number,
  portfolioData: TokenBalance[],
): Promise<void> {
  try {
    const network = chainIdToAlchemyNetwork[chainId]
    if (!network) return

    const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || ""
    if (!alchemyApiKey) return

    console.log(`Fetching native balance for chain ${network}...`)

    // Use Alchemy's JSON-RPC API
    const url = `https://${network}.g.alchemy.com/v2/${alchemyApiKey}`

    // Fetch native balance with rate limiting
    const response = await baseFetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_getBalance",
        params: [walletAddress, "latest"],
      }),
    })

    if (!response.ok) {
      console.warn(`Failed to fetch native balance for chain ${network}: ${response.status}`)
      return
    }

    const data = await response.json()
    const balanceHex = data.result

    // Convert hex balance to decimal
    const balanceWei = BigInt(balanceHex)
    if (balanceWei <= 0) return

    // Convert wei to ether
    const balance = Number(balanceWei) / 1e18

    // Get native token info
    const nativeTokenInfo = getNativeTokenInfo(chainId)

    // Get native token price with rate limiting
    console.log(`Fetching native token price for chain ${chainId}...`)
    const { price, priceChange24h } = await fetchNativeTokenPrice(chainId)
    const balanceUsd = balance * price

    portfolioData.push({
      tokenAddress: "0x0000000000000000000000000000000000000000",
      symbol: nativeTokenInfo.symbol,
      name: nativeTokenInfo.name,
      balance: balance.toString(),
      decimals: 18,
      priceUsd: price.toString(),
      balanceUsd,
      chainId,
      chainName: chainIdToName[chainId] || `Chain ${chainId}`,
      tokenType: "NATIVE",
      priceChange24h,
    })
  } catch (error) {
    console.error(`Error fetching native balance for chain ${chainId}:`, error)
  }
}

/**
 * Get native token info for a chain
 */
/**
 * Fetch token price history
 */
export async function fetchTokenPriceHistory(tokenAddress: string, chainId: number, days = 30): Promise<any[]> {
  try {
    // Check if we have cached history data
    const cacheKey = `history_${chainId}_${tokenAddress}_${days}`
    const cachedData = localStorage.getItem(cacheKey)

    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData)
      const cacheAge = Date.now() - timestamp

      // Use cache if it's less than 1 hour old
      if (cacheAge < 60 * 60 * 1000) {
        return data
      }
    }

    console.log(`Fetching price history for token ${tokenAddress} on chain ${chainId}...`)

    // For now, return empty array as real price history requires paid API access
    console.log("Fetching token price history requires paid API access")
    return []
  } catch (error) {
    console.error("Error fetching token price history:", error)
    return []
  }
}
