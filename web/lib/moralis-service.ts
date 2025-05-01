import Moralis from "moralis"
import { EvmChain } from "@moralisweb3/common-evm-utils"
import type { TokenBalance } from "@/lib/portfolio-service"
import { createClient } from "@/lib/supabase/client"
import { getChainName, SUPPORTED_CHAIN_IDS, getChainById } from "@/lib/chain-utils"
import { respectRateLimit } from "@/lib/api-client"

// Track whether Moralis has been initialized
let moralisInitialized = false

// Chain ID to name mapping - use our chain utility
const chainIdToName: Record<number, string> = {}
SUPPORTED_CHAIN_IDS.forEach((chainId) => {
  chainIdToName[chainId] = getChainName(chainId)
})

// Chain ID mapping for Moralis API - using EvmChain enum
// We still need this mapping because Moralis has its own chain identifiers
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

// Wrapped ETH addresses for each chain
const wrappedEthAddresses: Record<number, string> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH on Ethereum
  8453: "0x4200000000000000000000000000000000000006", // WETH on Base
  84532: "0x4200000000000000000000000000000000000006", // WETH on Base Sepolia
}

// Supported chains - ETH, BASE, and BASE SEPOLIA
const supportedChains = SUPPORTED_CHAIN_IDS

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

// Token information interface
export interface TokenInfo {
  symbol: string
  name?: string
  price: number
  priceChange24h?: number
  marketCap?: number
  volume24h?: number
  contractAddress: string
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

// Initialize Moralis (call this before using other functions)
export async function initializeMoralis(): Promise<boolean> {
  try {
    // If Moralis is already initialized, return true immediately
    if (moralisInitialized) {
      console.log("Moralis already initialized, skipping initialization")
      return true
    }

    const moralisApiKey = process.env.MORALIS_API_KEY
    if (!moralisApiKey) {
      console.error("Moralis API key not found")
      return false
    }

    await Moralis.start({
      apiKey: moralisApiKey,
    })

    // Set the flag to true after successful initialization
    moralisInitialized = true
    console.log("Moralis initialized successfully")
    return true
  } catch (error) {
    // If the error is about modules already started, just set the flag to true
    if (error instanceof Error && error.message.includes("Modules are started already")) {
      console.log("Moralis was already initialized elsewhere")
      moralisInitialized = true
      return true
    }

    console.error("Error initializing Moralis:", error)
    return false
  }
}

/**
 * Helper function to delay execution
 */
const delay = async (ms: number) => await respectRateLimit("moralis", ms)

/**
 * Get token info from Supabase token_metadata table
 */
async function getTokenInfoFromSupabase(ticker: string, chainId?: number): Promise<TokenInfo | null> {
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
    }

    return tokenInfo
  } catch (error) {
    console.error("Error in getTokenInfoFromSupabase:", error)
    return null
  }
}

/**
 * Get token info by ticker symbol with caching
 */
export async function getTokenInfoByTicker(ticker: string, chainId?: number): Promise<TokenInfo | null> {
  try {
    // Normalize ticker
    const normalizedTicker = ticker.toUpperCase()

    // Check cache first
    const cacheKey = chainId ? `${chainId}:${normalizedTicker}` : normalizedTicker
    const cachedInfo = tokenInfoCache[cacheKey]

    if (cachedInfo && Date.now() - cachedInfo.timestamp < TOKEN_INFO_CACHE_TTL) {
      return cachedInfo.data
    }

    // First, try to get token info from our Supabase database
    const supabaseTokenInfo = await getTokenInfoFromSupabase(normalizedTicker, chainId)

    if (supabaseTokenInfo) {
      console.log(`Found token ${normalizedTicker} in Supabase database`)

      // We still need to fetch the price data
      try {
        // Initialize Moralis if not already initialized
        const initialized = await initializeMoralis()
        if (!initialized) {
          throw new Error("Failed to initialize Moralis")
        }

        // Get the chain for price lookup
        const moralisChain = chainIdToMoralisChain[supabaseTokenInfo.chainId]
        if (moralisChain) {
          // Get token price data
          const priceResponse = await Moralis.EvmApi.token.getTokenPrice({
            chain: moralisChain,
            address: supabaseTokenInfo.contractAddress,
          })

          if (priceResponse.raw) {
            supabaseTokenInfo.price = priceResponse.raw.usdPrice || 0
            supabaseTokenInfo.marketCap = priceResponse.raw.usdMarketCap || 0
            supabaseTokenInfo.volume24h = priceResponse.raw.usdVolume24h || 0
          }
        }
      } catch (priceError) {
        console.warn(`Error fetching price for ${normalizedTicker}:`, priceError)
        // Continue with price = 0
      }

      // Cache the result
      tokenInfoCache[cacheKey] = {
        data: supabaseTokenInfo,
        timestamp: Date.now(),
      }

      return supabaseTokenInfo
    }

    // If not found in Supabase, continue with the original implementation
    // Initialize Moralis if not already initialized
    const initialized = await initializeMoralis()
    if (!initialized) {
      throw new Error("Failed to initialize Moralis")
    }

    // Handle special case for ETH (native token)
    if (normalizedTicker === "ETH") {
      return await getNativeTokenInfo(chainId)
    }

    // Determine which chains to search
    const chainsToSearch = chainId ? [chainId] : supportedChains

    // Try each chain in priority order
    for (const currentChainId of chainsToSearch) {
      try {
        const moralisChain = chainIdToMoralisChain[currentChainId]
        if (!moralisChain) continue

        console.log(`Searching for ${normalizedTicker} on ${chainIdToName[currentChainId]}...`)

        // Use getTokenMetadataBySymbol instead of search (free tier compatible)
        const response = await Moralis.EvmApi.token.getTokenMetadataBySymbol({
          chain: moralisChain,
          symbols: [normalizedTicker],
        })

        if (response.raw && response.raw.length > 0) {
          // If we have multiple tokens with the same symbol, we need to find the one with the highest market cap
          // and that contains links information
          if (response.raw.length > 1) {
            console.log(
              `Found ${response.raw.length} tokens with symbol ${normalizedTicker}, finding the best match...`,
            )

            // First, try to find tokens that have links information
            const tokensWithLinks = response.raw.filter(
              (token) => token.links && Object.values(token.links).some((link) => link && link.length > 0),
            )

            // If we have tokens with links, sort them by market cap
            // Otherwise, sort all tokens by market cap
            const tokensToSort = tokensWithLinks.length > 0 ? tokensWithLinks : response.raw

            // Sort tokens by market cap (descending)
            const sortedTokens = [...tokensToSort].sort((a, b) => {
              const marketCapA = a.market_cap ? Number.parseFloat(a.market_cap) : 0
              const marketCapB = b.market_cap ? Number.parseFloat(b.market_cap) : 0
              return marketCapB - marketCapA
            })

            // Use the token with the highest market cap
            const bestToken = sortedTokens[0]
            console.log(
              `Selected token: ${bestToken.name} (${bestToken.address}), Market Cap: $${bestToken.market_cap || "unknown"}, Has Links: ${!!bestToken.links}`,
            )

            // Now get price data only for the selected token
            const priceResponse = await Moralis.EvmApi.token.getTokenPrice({
              chain: moralisChain,
              address: bestToken.address,
            })

            const tokenInfo: TokenInfo = {
              symbol: bestToken.symbol,
              name: bestToken.name,
              price: priceResponse.raw.usdPrice || 0,
              priceChange24h: 0, // We don't have this data in the basic API response
              marketCap: priceResponse.raw.usdMarketCap || Number.parseFloat(bestToken.market_cap || "0"),
              volume24h: priceResponse.raw.usdVolume24h || 0,
              contractAddress: bestToken.address,
              chain: chainIdToName[currentChainId],
              chainId: currentChainId,
              logo: bestToken.logo || undefined,
              links: bestToken.links || undefined,
            }

            // Cache the result
            tokenInfoCache[cacheKey] = {
              data: tokenInfo,
              timestamp: Date.now(),
            }

            return tokenInfo
          } else {
            // If there's only one token, proceed as before
            const token = response.raw[0]

            // Get token price data with market cap and volume
            const priceResponse = await Moralis.EvmApi.token.getTokenPrice({
              chain: moralisChain,
              address: token.address,
            })

            // Try to get additional market data from CoinGecko for more complete information
            let marketCap = priceResponse.raw.usdMarketCap || 0
            let volume24h = priceResponse.raw.usdVolume24h || 0

            // If market cap or volume is missing, try to get it from CoinGecko
            if (marketCap === 0 || volume24h === 0) {
              try {
                const platformId = getCoinGeckoPlatformId(currentChainId)
                const coinGeckoResponse = await fetch(
                  `https://api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${token.address}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true`,
                  { headers: { Accept: "application/json" } },
                )

                if (coinGeckoResponse.ok) {
                  const data = await coinGeckoResponse.json()
                  const tokenData = data[token.address.toLowerCase()]
                  if (tokenData) {
                    marketCap = tokenData.usd_market_cap || marketCap
                    volume24h = tokenData.usd_24h_vol || volume24h
                  }
                }
              } catch (error) {
                console.warn(`Failed to fetch additional market data from CoinGecko:`, error)
              }
            }

            const tokenInfo: TokenInfo = {
              symbol: token.symbol,
              name: token.name,
              price: priceResponse.raw.usdPrice || 0,
              priceChange24h: 0, // We don't have this data in the basic API response
              marketCap: marketCap,
              volume24h: volume24h,
              contractAddress: token.address,
              chain: chainIdToName[currentChainId],
              chainId: currentChainId,
              logo: token.logo || undefined,
              links: token.links || undefined,
            }

            // Cache the result
            tokenInfoCache[cacheKey] = {
              data: tokenInfo,
              timestamp: Date.now(),
            }

            return tokenInfo
          }
        }
      } catch (error) {
        console.warn(`Token ${normalizedTicker} not found on ${chainIdToName[currentChainId]}, trying next chain...`)
        await delay(300) // Add a small delay to avoid rate limiting
        continue
      }
    }

    console.error(`Token ${normalizedTicker} not found on any configured chains`)
    return null
  } catch (error) {
    console.error("Error fetching token info:", error)
    return null
  }
}

/**
 * Map chain ID to CoinGecko platform ID
 */
function getCoinGeckoPlatformId(chainId: number): string {
  const platformMap: Record<number, string> = {
    1: "ethereum",
    8453: "base",
    84532: "base", // Use "base" for Base Sepolia as CoinGecko might not have a specific endpoint
  }
  return platformMap[chainId] || "ethereum"
}

/**
 * Get native token (ETH) info
 */
async function getNativeTokenInfo(chainId?: number): Promise<TokenInfo | null> {
  try {
    // Determine which chains to search
    const chainsToSearch = chainId ? [chainId] : supportedChains

    // Try each chain in priority order
    for (const currentChainId of chainsToSearch) {
      try {
        const moralisChain = chainIdToMoralisChain[currentChainId]
        if (!moralisChain) continue

        // Get the wrapped ETH address for this chain
        const wrappedEthAddress = wrappedEthAddresses[currentChainId]
        if (!wrappedEthAddress) continue

        // Get the price of wrapped ETH as a proxy for native ETH price
        const priceResponse = await Moralis.EvmApi.token.getTokenPrice({
          chain: moralisChain,
          address: wrappedEthAddress,
        })

        if (priceResponse && priceResponse.raw) {
          // For ETH, try to get additional market data from CoinGecko
          let marketCap = priceResponse.raw.usdMarketCap || 0
          let volume24h = priceResponse.raw.usdVolume24h || 0

          try {
            const response = await fetch(
              "https://api.coingecko.com/api/v3/coins/ethereum?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false",
            )
            if (response.ok) {
              const data = await response.json()
              marketCap = data.market_data?.market_cap?.usd || marketCap
              volume24h = data.market_data?.total_volume?.usd || volume24h
            }
          } catch (error) {
            console.warn("Failed to fetch ETH market data from CoinGecko:", error)
          }

          return {
            symbol: "ETH",
            name: "Ethereum",
            price: priceResponse.raw.usdPrice || 0,
            priceChange24h: 0, // We don't have this data in the basic API response
            marketCap: marketCap,
            volume24h: volume24h,
            contractAddress: "0x0000000000000000000000000000000000000000",
            chain: chainIdToName[currentChainId],
            chainId: currentChainId,
          }
        }
      } catch (error) {
        console.warn(`Native token price not found on ${chainIdToName[currentChainId]}, trying next chain...`)
        await delay(300) // Add a small delay to avoid rate limiting
        continue
      }
    }

    // Fallback to a default value if we couldn't get the price
    return {
      symbol: "ETH",
      name: "Ethereum",
      price: 3500, // Default fallback price
      priceChange24h: 0,
      marketCap: 0,
      volume24h: 0,
      contractAddress: "0x0000000000000000000000000000000000000000",
      chain: chainId ? chainIdToName[chainId] : "Ethereum",
      chainId: chainId || 1,
    }
  } catch (error) {
    console.error("Error fetching native token info:", error)
    return null
  }
}

/**
 * Fetch wallet token balances across multiple chains using Moralis API
 * Fetches balances and prices separately
 */
export async function fetchWalletTokensWithMoralis(walletAddress: string): Promise<TokenBalance[]> {
  try {
    // Initialize Moralis
    const initialized = await initializeMoralis()
    if (!initialized) {
      throw new Error("Failed to initialize Moralis")
    }

    const portfolioData: TokenBalance[] = []

    // Process chains strictly sequentially to avoid rate limits
    for (const chainId of supportedChains) {
      const moralisChain = chainIdToMoralisChain[chainId]
      if (!moralisChain) continue

      try {
        console.log(`Fetching tokens for chain ${moralisChain} (${chainIdToName[chainId]})...`)

        // Use the Moralis SDK to get token balances - with EvmChain enum
        const response = await Moralis.EvmApi.token.getWalletTokenBalances({
          address: walletAddress,
          chain: moralisChain,
        })

        if (response.raw && response.raw.length > 0) {
          // Process token data and fetch prices separately
          for (const token of response.raw) {
            try {
              // Get token price in a separate call
              const priceResponse = await Moralis.EvmApi.token.getTokenPrice({
                chain: moralisChain,
                address: token.token_address,
              })

              const balance = Number(token.balance) / Math.pow(10, Number(token.decimals))
              const price = priceResponse.raw?.usdPrice || 0
              const balanceUsd = balance * price

              portfolioData.push({
                tokenAddress: token.token_address,
                symbol: token.symbol,
                name: token.name,
                balance: balance.toString(),
                decimals: Number(token.decimals),
                priceUsd: price.toString(),
                balanceUsd,
                chainId,
                chainName: chainIdToName[chainId] || `Chain ${chainId}`,
                logo: token.logo || "",
                tokenType: "ERC20",
                priceChange24h: 0, // We don't have this data in the basic API response
              })

              // Add a small delay between price requests to avoid rate limiting
              await delay(100)
            } catch (priceError) {
              console.warn(`Error fetching price for token ${token.symbol}:`, priceError)
              // Still add the token to the portfolio, but with price 0
              const balance = Number(token.balance) / Math.pow(10, Number(token.decimals))

              portfolioData.push({
                tokenAddress: token.token_address,
                symbol: token.symbol,
                name: token.name,
                balance: balance.toString(),
                decimals: Number(token.decimals),
                priceUsd: "0",
                balanceUsd: 0,
                chainId,
                chainName: chainIdToName[chainId] || `Chain ${chainId}`,
                logo: token.logo || "",
                tokenType: "ERC20",
                priceChange24h: 0,
              })
            }
          }
        }

        // Also fetch native balance for this chain
        await fetchNativeBalance(walletAddress, moralisChain, chainId, portfolioData)

        // Add extra delay between chains to be extra safe
        await delay(1000)
      } catch (error) {
        console.error(`Error fetching tokens for chain ${moralisChain}:`, error)
      }
    }

    // Sort by USD value (descending)
    portfolioData.sort((a, b) => b.balanceUsd - a.balanceUsd)

    return portfolioData
  } catch (error) {
    console.error("Error fetching portfolio data with Moralis:", error)
    throw error
  }
}

/**
 * Fetch native token balances (ETH, BNB, MATIC, etc.) with prices
 */
async function fetchNativeBalance(
  walletAddress: string,
  moralisChain: any,
  chainId: number,
  portfolioData: TokenBalance[],
): Promise<void> {
  try {
    console.log(`Fetching native balance for chain ${moralisChain}...`)

    // Get native balance using Moralis SDK
    const balanceResponse = await Moralis.EvmApi.balance.getNativeBalance({
      address: walletAddress,
      chain: moralisChain,
    })

    if (balanceResponse.raw && Number(balanceResponse.raw.balance) > 0) {
      // Get native token price using wrapped ETH as a proxy
      const wrappedEthAddress = wrappedEthAddresses[chainId]
      let price = 3500 // Default fallback price

      if (wrappedEthAddress) {
        try {
          const priceResponse = await Moralis.EvmApi.token.getTokenPrice({
            chain: moralisChain,
            address: wrappedEthAddress,
          })

          if (priceResponse && priceResponse.raw) {
            price = priceResponse.raw.usdPrice || price
          }
        } catch (priceError) {
          console.warn(`Error fetching native token price for chain ${moralisChain}, using default:`, priceError)
        }
      }

      const balance = Number(balanceResponse.raw.balance) / 1e18
      const balanceUsd = balance * price

      portfolioData.push({
        tokenAddress: "0x0000000000000000000000000000000000000000",
        symbol: "ETH",
        name: "Ethereum",
        balance: balance.toString(),
        decimals: 18,
        priceUsd: price.toString(),
        balanceUsd,
        chainId,
        chainName: chainIdToName[chainId] || `Chain ${chainId}`,
        tokenType: "NATIVE",
        priceChange24h: 0, // We don't have this data in the basic API response
      })
    }
  } catch (error) {
    console.error(`Error fetching native balance for chain ${moralisChain}:`, error)
  }
}

/**
 * Fetch token price history
 */
export async function fetchTokenPriceHistory(tokenAddress: string, chain: string, days = 30): Promise<any[]> {
  try {
    // Initialize Moralis
    const initialized = await initializeMoralis()
    if (!initialized) {
      throw new Error("Failed to initialize Moralis")
    }

    // Check if we have cached history data
    const cacheKey = `history_${chain}_${tokenAddress}_${days}`
    const cachedData = localStorage.getItem(cacheKey)

    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData)
      const cacheAge = Date.now() - timestamp

      // Use cache if it's less than 1 hour old
      if (cacheAge < 60 * 60 * 1000) {
        return data
      }
    }

    // Convert chain string to Moralis chain format
    let moralisChain: any
    switch (chain) {
      case "eth":
        moralisChain = EvmChain.ETHEREUM
        break
      case "base":
        moralisChain = EvmChain.BASE
        break
      case "base-sepolia":
        moralisChain = EvmChain.BASE_SEPOLIA
        break
      default:
        moralisChain = EvmChain.ETHEREUM // Default to Ethereum
    }

    // Use Moralis API to get token price history
    // This is a paid API feature, so we'll need to handle the case where it's not available
    console.log("Fetching token price history from Moralis API is not available in the free tier")

    // Return empty array if we can't get real data
    return []
  } catch (error) {
    console.error("Error fetching token price history:", error)
    return []
  }
}
