"use client"

import { fetchWalletTokens, getPortfolioSummary } from "@/lib/portfolio-service"
import { getTokenInfoByTicker } from "@/lib/token-price-service"
import {
  getSwapQuote,
  executeSwap,
  getTokenAddressBySymbol,
  getTokenInfo,
  formatAmount,
  isChainSupportedForTrading,
  checkTokenAllowance,
  approveTokenSpending,
  checkSufficientBalance,
  estimateSellAmount,
} from "@/lib/0x-service"
import { ethers } from "ethers"
import { getChainByName, getChainName, isChainSupported, DEFAULT_CHAIN, getExplorerTxUrl } from "@/lib/chain-utils"

// Define a type for command results
export interface CommandResult {
  content: string
  isProcessing?: boolean
  commandId?: string
}

export class CommandParser {
  private walletAddress: string | undefined
  private commandCallbacks: Map<string, (result: string) => void>
  private tokenInfoCache: Map<string, any> // Cache for token info to ensure consistency between calls

  constructor(walletAddress: string | undefined) {
    this.walletAddress = walletAddress
    this.commandCallbacks = new Map()
    this.tokenInfoCache = new Map()
  }

  /**
   * Register a callback for a specific command ID
   * @param commandId The unique ID for the command
   * @param callback The callback to call when the command completes
   */
  public registerCallback(commandId: string, callback: (result: string) => void): void {
    console.log(`Registering callback for command ${commandId}`)
    this.commandCallbacks.set(commandId, callback)
  }

  /**
   * Unregister a callback for a specific command ID
   * @param commandId The unique ID for the command
   */
  public unregisterCallback(commandId: string): void {
    console.log(`Unregistering callback for command ${commandId}`)
    this.commandCallbacks.delete(commandId)
  }

  /**
   * Parse a streaming response from OpenAI
   * @param response The fetch response object
   * @returns The parsed content as a string
   */
  private async parseStreamingResponse(response: Response): Promise<string> {
    // Create a reader for the response stream
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    let fullResponse = ""

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        // Decode the chunk
        const chunk = decoder.decode(value)

        // Split the chunk by newlines to handle multiple SSE messages
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const jsonStr = line.slice(6) // Remove 'data: ' prefix
              if (jsonStr === "[DONE]") {
                // Stream is complete
                break
              }

              const data = JSON.parse(jsonStr)

              // Check if there's content in the delta
              if (data.choices?.[0]?.delta?.content) {
                const content = data.choices[0].delta.content
                fullResponse += content

                // Log each chunk for debugging
                console.log("New content chunk received")
              }
            } catch (e) {
              console.error("Error parsing chunk:", e, "Line:", line)
              // Continue processing other chunks even if one fails
            }
          }
        }
      }

      return fullResponse
    } catch (error) {
      console.error("Error reading stream:", error)
      throw new Error("Failed to read streaming response")
    } finally {
      // Make sure to release the reader
      reader.releaseLock()
    }
  }

  async parseCommand(command: string): Promise<CommandResult> {
    if (!this.walletAddress) {
      return { content: "Please connect your wallet first." }
    }

    // We only handle slash commands here - natural language is processed by OpenAI
    if (!command.startsWith("/")) {
      return {
        content: `I couldn't understand that as a command. Try using slash commands like /portfolio, /buy, or /sell, or ask me a question about crypto trading.`,
      }
    }

    const parts = command.trim().split(" ")
    const cmd = parts[0].toLowerCase()
    const commandId = `cmd-${Date.now()}`

    switch (cmd) {
      case "/portfolio":
        return this.getPortfolioSummary()

      case "/analyze":
        if (parts[1]?.toLowerCase() === "portfolio") {
          return this.analyzePortfolio()
        }
        return { content: "Invalid analyze command. Usage: /analyze portfolio" }

      case "/buy":
        if (parts.length < 3) {
          return { content: "Invalid buy command. Usage: /buy [token] [amount]" }
        }
        return this.executeBuyOrder(parts[1], parts[2], parts[3] || "ETH", commandId)

      case "/sell":
        if (parts.length < 3) {
          return { content: "Invalid sell command. Usage: /sell [token] [amount]" }
        }
        return this.executeSellOrder(parts[1], parts[2], parts[3] || "ETH", commandId)

      case "/market":
        if (parts.length < 2) {
          return { content: "Invalid market command. Usage: /market [token]" }
        }
        return this.getMarketInfo(parts[1], commandId)

      case "/recommend":
        return this.getRecommendations(commandId)

      default:
        return {
          content: `Unknown command: ${cmd}. Available commands: /portfolio, /analyze portfolio, /buy, /sell, /market, /recommend`,
        }
    }
  }

  private async getPortfolioSummary(): Promise<CommandResult> {
    try {
      const portfolioData = await fetchWalletTokens(this.walletAddress!)
      return { content: getPortfolioSummary(portfolioData) }
    } catch (error) {
      console.error("Error fetching portfolio summary:", error)
      return { content: "Error fetching portfolio data. Please try again later." }
    }
  }

  private async analyzePortfolio(): Promise<CommandResult> {
    try {
      const portfolioData = await fetchWalletTokens(this.walletAddress!)

      if (portfolioData.length === 0) {
        return { content: "Your portfolio is empty. Consider adding some assets to analyze." }
      }

      // Calculate total portfolio value
      const totalValue = portfolioData.reduce((sum, token) => sum + token.balanceUsd, 0)

      // Sort tokens by value
      const sortedTokens = [...portfolioData].sort((a, b) => b.balanceUsd - a.balanceUsd)

      // Calculate chain distribution
      const chainDistribution: Record<string, number> = {}
      portfolioData.forEach((token) => {
        chainDistribution[token.chainName] = (chainDistribution[token.chainName] || 0) + token.balanceUsd
      })

      // Calculate risk metrics (simplified)
      const stablecoins = portfolioData.filter((token) => ["USDC", "USDT", "DAI"].includes(token.symbol))
      const stablecoinValue = stablecoins.reduce((sum, token) => sum + token.balanceUsd, 0)
      const stablecoinPercentage = (stablecoinValue / totalValue) * 100

      // Generate analysis
      let analysis = `## Portfolio Analysis\n\n`

      // Overall summary
      analysis += `Your portfolio is worth $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across ${portfolioData.length} assets.\n\n`

      // Top holdings
      analysis += `### Top Holdings\n`
      sortedTokens.slice(0, 5).forEach((token, index) => {
        const percentage = ((token.balanceUsd / totalValue) * 100).toFixed(1)
        analysis += `${index + 1}. ${token.symbol}: $${token.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)\n`
      })
      analysis += `\n`

      // Chain distribution
      analysis += `### Chain Distribution\n`
      Object.entries(chainDistribution)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .forEach(([chain, value]) => {
          const percentage = (((value as number) / totalValue) * 100).toFixed(1)
          analysis += `- ${chain}: $${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })} (${percentage}%)\n`
        })
      analysis += `\n`

      // Risk assessment
      analysis += `### Risk Assessment\n`
      analysis += `- Stablecoin allocation: ${stablecoinPercentage.toFixed(1)}%\n`

      if (stablecoinPercentage < 10) {
        analysis += `- Your portfolio has a low stablecoin allocation, which may indicate higher risk exposure.\n`
        analysis += `- Consider adding more stablecoins for better risk management. Try: /buy USDC 100 ETH\n`
      } else if (stablecoinPercentage > 50) {
        analysis += `- Your portfolio has a high stablecoin allocation, which may limit potential returns.\n`
        analysis += `- Consider diversifying into more assets for better growth potential. Try: /buy ETH 0.1 USDC\n`
      } else {
        analysis += `- Your stablecoin allocation is balanced, providing a good mix of stability and growth potential.\n`
      }

      // Recommendations
      analysis += `\n### Recommendations\n`

      // If portfolio is heavily concentrated in one asset
      const topTokenPercentage = sortedTokens.length > 0 ? (sortedTokens[0].balanceUsd / totalValue) * 100 : 0
      if (topTokenPercentage > 70) {
        analysis += `- Your portfolio is heavily concentrated in ${sortedTokens[0].symbol} (${topTokenPercentage.toFixed(1)}%).\n`
        analysis += `- Consider diversifying to reduce risk. Try: /sell ${sortedTokens[0].symbol} ${(Number(sortedTokens[0].balance) * 0.2).toFixed(4)} USDC\n`
      }

      // If no ETH exposure
      const hasEth = portfolioData.some((token) => token.symbol === "ETH" || token.symbol === "WETH")
      if (!hasEth) {
        analysis += `- You don't have any ETH exposure. Consider adding some: /buy ETH 0.1 USDC\n`
      }

      return { content: analysis }
    } catch (error) {
      console.error("Error analyzing portfolio:", error)
      return { content: "Error analyzing portfolio data. Please try again later." }
    }
  }

  // Updated getMarketInfo method to use chain utilities and indicate processing
  private async getMarketInfo(tokenSymbol: string, commandId?: string): Promise<CommandResult> {
    try {
      // Normalize token symbol
      const normalizedSymbol = tokenSymbol.toUpperCase()

      // Check if the token symbol includes chain specification
      // Format would be "ETH ON ETHEREUM" from the slash command
      let specifiedChain = DEFAULT_CHAIN.id
      let cleanSymbol = normalizedSymbol

      if (normalizedSymbol.includes(" ON ")) {
        const parts = normalizedSymbol.split(" ON ")
        cleanSymbol = parts[0].trim()
        const chainName = parts[1].trim()

        // Use the chain utility to get chain by name
        const chain = getChainByName(chainName)
        specifiedChain = chain.id

        console.log(`Detected chain specification: ${chainName} (${specifiedChain})`)
      }

      // Default to Base unless specified or connected to a different chain
      let chainId = DEFAULT_CHAIN.id

      // If a chain was specified in the message, use that
      if (specifiedChain) {
        chainId = specifiedChain
      }
      // Otherwise, if window and ethereum are available, check the current chain
      else if (typeof window !== "undefined" && window.ethereum) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum)
          const network = await provider.getNetwork()
          const connectedChainId = Number(network.chainId)

          // Only use the connected chain if it's supported
          if (isChainSupported(connectedChainId)) {
            chainId = connectedChainId
          }
          // Otherwise stick with Base as default
        } catch (error) {
          console.error("Error getting network:", error)
          // Fall back to Base chain
        }
      }

      console.log(`Getting market info for ${cleanSymbol} on chain ${chainId}`)

      // Format market cap and volume with proper units (B for billions, M for millions, etc.)
      const formatLargeNumber = (num: number | undefined): string => {
        if (num === undefined || num === 0) return "$0"
        if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
        if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
        if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`
        return `$${num.toLocaleString()}`
      }

      // Create a cache key for this token and chain
      const cacheKey = `${chainId}:${cleanSymbol}`

      // Always fetch fresh token info for market info command
      console.log(`Fetching fresh token info for ${cleanSymbol} on chain ${chainId}`)
      const tokenInfo = await getTokenInfoByTicker(cleanSymbol, chainId)

      if (!tokenInfo) {
        return { content: `Token ${cleanSymbol} not found or not supported on ${getChainName(chainId)}.` }
      }

      // Separately fetch portfolio data to check if the user holds this token
      // This doesn't affect the price display, just shows holdings info if available
      let userToken = null
      try {
        const portfolioData = await fetchWalletTokens(this.walletAddress!)
        userToken = portfolioData.find((token) => token.symbol === cleanSymbol)
      } catch (error) {
        console.warn("Error fetching portfolio data for holdings info:", error)
        // Continue without portfolio data - we'll just not show holdings
      }

      // Get chain name for display using our utility
      const chainName = getChainName(chainId)

      // Ensure we have the chain and contract address
      const chainDisplay = tokenInfo.chain || chainName
      const contractAddress = tokenInfo.contractAddress || "Not available"

      // Create initial response without AI analysis
      const initialResponse = `
## ${cleanSymbol} Market Information on ${chainName}

**Current Price:** $${tokenInfo.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
${tokenInfo.marketCap && tokenInfo.marketCap > 0 ? `**Market Cap:** ${formatLargeNumber(tokenInfo.marketCap)}` : ""}
${userToken ? `**Your Holdings:** ${Number(userToken.balance).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })} ${cleanSymbol} ($${userToken.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })})` : ""}
**Chain:** ${chainDisplay}
**Contract:** \`${contractAddress}\`

### Trading Actions
- Buy ${cleanSymbol}: /buy ${cleanSymbol} 0.1 ETH
- Sell ${cleanSymbol}: /sell ${cleanSymbol} 0.1 ETH
`

      // Return initial response and indicate that processing is continuing
      const result: CommandResult = {
        content: initialResponse,
        isProcessing: true,
        commandId,
      }

      // Continue processing in the background to get AI analysis
      this.fetchMarketAnalysis(cleanSymbol, tokenInfo, chainName, userToken, commandId).catch((error) => {
        console.error("Error fetching market analysis:", error)
        // If there's an error, we'll just leave the initial response

        // Make sure to unregister the callback to clear loading state
        if (commandId && this.commandCallbacks.has(commandId)) {
          const callback = this.commandCallbacks.get(commandId)!
          callback(initialResponse)
          this.unregisterCallback(commandId)
        }
      })

      return result
    } catch (error) {
      console.error("Error in getMarketInfo:", error)
      return { content: `Error fetching market information for ${tokenSymbol}. Please try again later.` }
    }
  }

  // New method to fetch market analysis asynchronously
  private async fetchMarketAnalysis(
    cleanSymbol: string,
    tokenInfo: any,
    chainName: string,
    userToken: any,
    commandId?: string,
  ): Promise<void> {
    try {
      // Format market cap and volume with proper units (B for billions, M for millions, etc.)
      const formatLargeNumber = (num: number | undefined): string => {
        if (num === undefined || num === 0) return "$0"
        if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
        if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
        if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`
        return `$${num.toLocaleString()}`
      }

      // Ensure we have the chain and contract address
      const chainDisplay = tokenInfo.chain || chainName
      const contractAddress = tokenInfo.contractAddress || "Not available"
      console.log(`Using contract address: ${contractAddress} for ${cleanSymbol}`)

      // Format the complete response with real data and AI analysis
      const completeResponse = `
## ${cleanSymbol} Market Information on ${chainName}

**Current Price:** $${tokenInfo.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
${tokenInfo.marketCap && tokenInfo.marketCap > 0 ? `**Market Cap:** ${formatLargeNumber(tokenInfo.marketCap)}` : ""}
${userToken ? `**Your Holdings:** ${Number(userToken.balance).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })} ${cleanSymbol} ($${userToken.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })})` : ""}
**Chain:** ${chainDisplay}
**Contract:** \`${contractAddress}\`

### Trading Actions
- Buy ${cleanSymbol}: /buy ${cleanSymbol} 0.1 ETH
- Sell ${cleanSymbol}: /sell ${cleanSymbol} 0.1 ETH
`

      // Call the callback if commandId is provided
      if (commandId && this.commandCallbacks.has(commandId)) {
        console.log(`Calling callback for command ${commandId} with complete response`)
        const callback = this.commandCallbacks.get(commandId)!
        callback(completeResponse)

        // Explicitly unregister the callback after it's called
        console.log(`Unregistering callback for command ${commandId}`)
        this.unregisterCallback(commandId)
      }
    } catch (error) {
      console.error("Error getting AI analysis:", error)

      // Ensure we have the chain and contract address
      const chainDisplay = tokenInfo.chain || chainName
      const contractAddress = tokenInfo.contractAddress || "Not available"

      // Format a response without AI analysis
      const fallbackResponse = `
## ${cleanSymbol} Market Information on ${chainName}

**Current Price:** $${tokenInfo.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
${tokenInfo.marketCap && tokenInfo.marketCap > 0 ? `**Market Cap:** ${formatLargeNumber(tokenInfo.marketCap)}` : ""}
${userToken ? `**Your Holdings:** ${Number(userToken.balance).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })} ${cleanSymbol} ($${userToken.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })})` : ""}
**Chain:** ${chainDisplay}
**Contract:** \`${contractAddress}\`

### Trading Actions
- Buy ${cleanSymbol}: /buy ${cleanSymbol} 0.1 ETH
- Sell ${cleanSymbol}: /sell ${cleanSymbol} 0.1 ETH
    `

      // Always call the callback, even if there's an error
      if (commandId && this.commandCallbacks.has(commandId)) {
        console.log(`Calling callback for command ${commandId} with fallback response after error`)
        const callback = this.commandCallbacks.get(commandId)!
        callback(fallbackResponse)

        // Explicitly unregister the callback after it's called
        console.log(`Unregistering callback for command ${commandId} after error`)
        this.unregisterCallback(commandId)
      }
    }
  }

  // Add this new function to the CommandParser class to generate AI-powered recommendations
  private async getRecommendations(commandId?: string): Promise<CommandResult> {
    try {
      // Fetch the user's portfolio data
      const portfolioData = await fetchWalletTokens(this.walletAddress!)

      if (portfolioData.length === 0) {
        return { content: "Your portfolio is empty. Consider adding some assets before requesting recommendations." }
      }

      // Calculate total portfolio value
      const totalValue = portfolioData.reduce((sum, token) => sum + token.balanceUsd, 0)

      // Sort tokens by value
      const sortedTokens = [...portfolioData].sort((a, b) => b.balanceUsd - a.balanceUsd)

      // Calculate chain distribution
      const chainDistribution: Record<string, number> = {}
      portfolioData.forEach((token) => {
        chainDistribution[token.chainName] = (chainDistribution[token.chainName] || 0) + token.balanceUsd
      })

      // Calculate risk metrics
      const stablecoins = portfolioData.filter((token) => ["USDC", "USDT", "DAI"].includes(token.symbol))
      const stablecoinValue = stablecoins.reduce((sum, token) => sum + token.balanceUsd, 0)
      const stablecoinPercentage = (stablecoinValue / totalValue) * 100

      // Create initial response
      const initialResponse = `
## AI-Powered Trading Recommendations

Analyzing your portfolio of $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })} across ${portfolioData.length} assets...

Generating personalized recommendations based on your holdings and market conditions. This may take a moment.
      `

      // Return initial response and indicate that processing is continuing
      const result: CommandResult = {
        content: initialResponse,
        isProcessing: true,
        commandId,
      }

      // Continue processing in the background
      this.fetchRecommendations(
        portfolioData,
        totalValue,
        stablecoinPercentage,
        chainDistribution,
        sortedTokens,
        commandId,
      ).catch((error) => {
        console.error("Error fetching recommendations:", error)
        // If there's an error, we'll use the fallback recommendations
        this.provideFallbackRecommendations(portfolioData, totalValue, stablecoinPercentage, commandId)
      })

      return result
    } catch (error) {
      console.error("Error generating recommendations:", error)
      return { content: "Error analyzing your portfolio. Please try again later." }
    }
  }

  // New method to fetch AI recommendations asynchronously
  private async fetchRecommendations(
    portfolioData: any[],
    totalValue: number,
    stablecoinPercentage: number,
    chainDistribution: Record<string, number>,
    sortedTokens: any[],
    commandId?: string,
  ): Promise<void> {
    try {
      // Prepare portfolio context for AI
      const portfolioContext = `
User's portfolio summary:
- Total value: $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })}
- Number of assets: ${portfolioData.length}
- Stablecoin allocation: ${stablecoinPercentage.toFixed(1)}%

Top holdings:
${sortedTokens
  .slice(0, 5)
  .map((token, index) => {
    const percentage = ((token.balanceUsd / totalValue) * 100).toFixed(1)
    return `${index + 1}. ${token.symbol} (${token.chainName}): $${token.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })} (${percentage}%)`
  })
  .join("\n")}

Chain distribution:
${Object.entries(chainDistribution)
  .sort(([, a], [, b]) => (b as number) - (a as number))
  .map(([chain, value]) => {
    const percentage = (((value as number) / totalValue) * 100).toFixed(1)
    return `- ${chain}: $${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })} (${percentage}%)`
  })
  .join("\n")}
`

      // Use the chat API to get AI-powered recommendations
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: `You are an AI Trading Agent specialized in cryptocurrency trading on Ethereum, Base, and Base Sepolia blockchains.
            
Based on the user's portfolio data, provide personalized trading recommendations. Focus on:
1. Portfolio diversification and risk management
2. Potential opportunities based on current market conditions
3. Specific actionable trades with reasoning
4. Balancing between chains (Ethereum, Base, Base Sepolia)

Format your recommendations as clickable commands like "/buy ETH 0.01 USDC" or "/sell WBTC 0.001 ETH".
Keep your response concise and focused on Ethereum, Base, and Base Sepolia chain tokens.
Provide 2-3 potential buys and 1-2 potential sells, with brief reasoning for each.`,
            },
            {
              role: "user",
              content: `Please analyze my portfolio and provide trading recommendations based on this data:\n\n${portfolioContext}`,
            },
          ],
          userId: null, // We don't need to save this interaction
          walletAddress: this.walletAddress,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to get AI recommendations")
      }

      // Check if the response body is available for streaming
      if (!response.body) {
        throw new Error("Response body is not available for streaming")
      }

      // Parse the streaming response
      console.log("Parsing streaming response for recommendations...")
      const aiRecommendation = await this.parseStreamingResponse(response)

      // If we couldn't extract any content, use a fallback
      if (!aiRecommendation) {
        throw new Error("No recommendation content received")
      }

      // Format the AI response with a header
      const completeResponse = `## AI-Powered Trading Recommendations\n\n${aiRecommendation}`

      // Call the callback if commandId is provided
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(completeResponse)

        // Explicitly unregister the callback after it's called
        console.log(`Unregistering callback for command ${commandId}`)
        this.unregisterCallback(commandId)
      }
    } catch (error) {
      console.error("Error in fetchRecommendations:", error)
      // Fall back to template recommendations if AI fails
      this.provideFallbackRecommendations(portfolioData, totalValue, stablecoinPercentage, commandId)
    } finally {
      // If we haven't called the callback yet (due to an error), call it with a fallback
      if (commandId && this.commandCallbacks.has(commandId)) {
        this.provideFallbackRecommendations(portfolioData, totalValue, stablecoinPercentage, commandId)
      }
    }
  }

  // Method to provide fallback recommendations
  private async provideFallbackRecommendations(
    portfolioData: any[],
    totalValue: number,
    stablecoinPercentage: number,
    commandId?: string,
  ): Promise<void> {
    try {
      const recommendations = this.getFallbackRecommendations(portfolioData, totalValue, stablecoinPercentage)

      // Call the callback if commandId is provided
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(recommendations)
        this.commandCallbacks.delete(commandId)
      }
    } catch (error) {
      console.error("Error providing fallback recommendations:", error)

      // Provide a very basic fallback if even the fallback fails
      const basicFallback = `
## Trading Recommendations

I couldn't analyze your portfolio at this time. Please try again later.

In the meantime, here are some general recommendations:

### Potential Buys
- /buy ETH 0.1 USDC - Ethereum remains a strong foundation for any crypto portfolio
- /buy WBTC 0.01 ETH - Bitcoin exposure provides stability in volatile markets

### Portfolio Management
- Consider a balanced approach with both growth assets and stablecoins
- Analyze your portfolio: /analyze portfolio
      `

      // Call the callback if commandId is provided
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(basicFallback)
        this.commandCallbacks.delete(commandId)
      }
    }
  }

  // Add this helper function for fallback recommendations
  private getFallbackRecommendations(portfolioData: any[], totalValue: number, stablecoinPercentage: number): string {
    // Sort tokens by value
    const sortedTokens = [...portfolioData].sort((a, b) => b.balanceUsd - a.balanceUsd)

    // Check portfolio concentration
    const topTokenPercentage = sortedTokens.length > 0 ? (sortedTokens[0].balanceUsd / totalValue) * 100 : 0
    const hasEth = portfolioData.some((token) => token.symbol === "ETH" || token.symbol === "WETH")
    const hasStablecoins = stablecoinPercentage > 5

    let recommendations = `
## Trading Recommendations

Based on your current portfolio of $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, minimumFractionDigits: 2 })}, here are some personalized recommendations:

### Potential Buys
`

    // Recommend ETH if they don't have it
    if (!hasEth) {
      recommendations += `- /buy ETH 0.1 USDC - Add Ethereum exposure as a core holding\n`
    }

    // Recommend stablecoins if allocation is low
    if (stablecoinPercentage < 10) {
      recommendations += `- /buy USDC 100 ETH - Increase stablecoin allocation for better risk management\n`
    }

    // Recommend diversification if portfolio is concentrated
    if (topTokenPercentage > 50 && sortedTokens.length > 0) {
      const topToken = sortedTokens[0]
      recommendations += `- /sell ${topToken.symbol} ${(Number(topToken.balance) * 0.2).toFixed(4)} USDC - Reduce concentration in ${topToken.symbol}\n`
    }

    // Add some general recommendations
    recommendations += `- /buy WBTC 0.01 ETH - Add Bitcoin exposure for portfolio stability\n`

    if (sortedTokens.length < 3) {
      recommendations += `- /buy LINK 10 USDC - Add Chainlink for oracle exposure and diversification\n`
    }

    recommendations += `
### Portfolio Adjustments
`

    if (stablecoinPercentage < 15) {
      recommendations += `- Consider increasing stablecoin allocation: /buy USDC 100 ETH\n`
    } else if (stablecoinPercentage > 50) {
      recommendations += `- Consider reducing stablecoin allocation for better growth potential\n`
    } else {
      recommendations += `- Your stablecoin allocation is well-balanced at ${stablecoinPercentage.toFixed(1)}%\n`
    }

    recommendations += `- Analyze your portfolio: /analyze portfolio

*These recommendations are based on your current portfolio composition and general market principles. They do not constitute financial advice.*
    `

    return recommendations
  }

  // Update the executeBuyOrder method to use the iterative approach for estimating sell amount
  private async executeBuyOrder(
    tokenSymbol: string,
    amount: string,
    payWith = "ETH",
    commandId?: string,
  ): Promise<CommandResult> {
    try {
      // Check if window and ethereum are available
      if (typeof window === "undefined" || !window.ethereum) {
        return {
          content:
            "Web3 provider not available. Please make sure you're using a browser with an Ethereum wallet extension.",
        }
      }

      // Check if 0x API key is available
      if (!process.env.NEXT_PUBLIC_0X_API_KEY) {
        return {
          content: "0x API key not found. Please add your 0x API key to the environment variables to execute trades.",
        }
      }

      // Initial response
      const initialResponse = `
## Processing Buy Order

Preparing to buy ${amount} ${tokenSymbol} with ${payWith}...

- Connecting to wallet
- Checking network compatibility
- Fetching token information
- Estimating trade parameters
      `

      // Return initial response and indicate that processing is continuing
      const result: CommandResult = {
        content: initialResponse,
        isProcessing: true,
        commandId,
      }

      // Continue processing in the background
      this.processBuyOrder(tokenSymbol, amount, payWith, commandId).catch((error) => {
        console.error("Error processing buy order:", error)

        // If there's an error, provide an error message
        if (commandId && this.commandCallbacks.has(commandId)) {
          const callback = this.commandCallbacks.get(commandId)!
          callback(`Error executing buy order: ${error.message || "Unknown error"}`)
          this.commandCallbacks.delete(commandId)
        }
      })

      return result
    } catch (error: any) {
      console.error("Error in executeBuyOrder:", error)
      return { content: `Error executing buy order: ${error.message || "Unknown error"}` }
    }
  }

  // New method to process buy orders asynchronously
  private async processBuyOrder(
    tokenSymbol: string,
    amount: string,
    payWith = "ETH",
    commandId?: string,
  ): Promise<void> {
    try {
      // Initialize provider - using ethers.js v6 BrowserProvider directly
      const provider = new ethers.BrowserProvider(window.ethereum)

      // Request account access
      await window.ethereum.request({ method: "eth_requestAccounts" })

      // Get the network
      const network = await provider.getNetwork()
      const chainId = Number(network.chainId)

      // Check if the chain is supported using our chain utility
      if (!isChainSupportedForTrading(chainId)) {
        throw new Error(`Chain ID ${chainId} not supported. Please switch to Ethereum Mainnet, Base, or Base Sepolia.`)
      }

      // Get chain name using our chain utility
      const chainName = getChainName(chainId)

      // Update progress
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`
## Processing Buy Order

Connected to wallet on ${chainName}

- ✅ Connected to wallet
- ✅ Network compatibility confirmed
- Fetching token information
- Estimating trade parameters
        `)
      }

      // Get token addresses
      const buyTokenAddress = getTokenAddressBySymbol(chainId, tokenSymbol)
      const sellTokenAddress = getTokenAddressBySymbol(chainId, payWith)

      if (!buyTokenAddress) {
        throw new Error(`Token ${tokenSymbol} not found or not supported on ${chainName}.`)
      }

      if (!sellTokenAddress) {
        throw new Error(`Token ${payWith} not found or not supported on ${chainName}.`)
      }

      // Get token info for decimals
      const buyTokenInfo = getTokenInfo(chainId, buyTokenAddress)
      const sellTokenInfo = getTokenInfo(chainId, sellTokenAddress)

      if (!buyTokenInfo) {
        throw new Error(`Could not get information for token ${tokenSymbol}.`)
      }

      if (!sellTokenInfo) {
        throw new Error(`Could not get information for token ${payWith}.`)
      }

      // Update progress
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`
## Processing Buy Order

Connected to wallet on ${chainName}

- ✅ Connected to wallet
- ✅ Network compatibility confirmed
- ✅ Token information retrieved
- Estimating trade parameters
        `)
      }

      // Format the target buy amount with proper decimals
      const targetBuyAmount = formatAmount(amount, buyTokenInfo.decimals)

      console.log(`Formatted target buy amount: ${targetBuyAmount}`)

      // First, show a message that we're estimating the sell amount
      console.log(`Estimating how much ${payWith} is needed to buy ${amount} ${tokenSymbol} on ${chainName}...`)

      // Use the iterative approach to estimate the sell amount needed
      const { sellAmount, buyAmount, quote } = await estimateSellAmount(
        chainId,
        sellTokenAddress,
        buyTokenAddress,
        targetBuyAmount,
        this.walletAddress,
      )

      // Calculate human-readable amounts
      const buyTokenDecimals = buyTokenInfo.decimals
      const sellTokenDecimals = sellTokenInfo.decimals

      const readableBuyAmount = (Number(buyAmount) / Math.pow(10, buyTokenDecimals)).toFixed(6)
      const readableSellAmount = (Number(sellAmount) / Math.pow(10, sellTokenDecimals)).toFixed(6)

      // Update progress
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`
## Trade Quote Summary

You are about to buy **${readableBuyAmount} ${tokenSymbol}** with **${readableSellAmount} ${payWith}** on ${chainName}.

- Price: 1 ${tokenSymbol} = ${Number(quote.price).toFixed(6)} ${payWith}
- Estimated price impact: ${Number(quote.estimatedPriceImpact) * 100}%
- Slippage tolerance: 1%
- Estimated gas: ${quote.estimatedGas}

Checking your balance...
        `)
      }

      // Check if user has sufficient balance
      const hasSufficientBalance = await checkSufficientBalance(
        provider,
        sellTokenAddress,
        this.walletAddress!,
        sellAmount,
      )

      if (!hasSufficientBalance) {
        // Get actual balance for a more helpful error message
        let actualBalance = "0"
        let readableActualBalance = "0"

        try {
          if (sellTokenAddress === "ETH") {
            const balance = await provider.getBalance(this.walletAddress!)
            actualBalance = balance.toString()
          } else {
            const erc20Abi = ["function balanceOf(address owner) view returns (uint256)"]
            const tokenContract = new ethers.Contract(sellTokenAddress, erc20Abi, provider)
            const balance = await tokenContract.balanceOf(this.walletAddress)
            actualBalance = balance.toString()
          }

          readableActualBalance = (Number(actualBalance) / Math.pow(10, sellTokenDecimals)).toFixed(6)
        } catch (error) {
          console.error("Error getting actual balance:", error)
        }

        throw new Error(
          `Insufficient balance. You need at least ${readableSellAmount} ${payWith} to complete this trade, but your balance is only ${readableActualBalance} ${payWith}. Please add funds or try a smaller amount.`,
        )
      }

      // Check if token approval is needed for ERC20 tokens
      if (sellTokenAddress !== "ETH") {
        const needsApproval = !(await checkTokenAllowance(
          provider,
          sellTokenAddress,
          this.walletAddress!,
          quote.allowanceTarget,
          sellAmount,
        ))

        if (needsApproval) {
          // Show approval message
          if (commandId && this.commandCallbacks.has(commandId)) {
            const callback = this.commandCallbacks.get(commandId)!
            callback(`
## Token Approval Required

Before executing this trade, you need to approve the 0x Protocol to spend your ${payWith} tokens.
This is a one-time approval that will allow the protocol to access your tokens for this and future trades.

Please approve the transaction in your wallet.
            `)
          }

          // Execute approval transaction
          const approvalTx = await approveTokenSpending(provider, sellTokenAddress, quote.allowanceTarget, sellAmount)

          // Wait for approval transaction to be mined
          const approvalReceipt = await approvalTx.wait()

          // Get transaction URL using our chain utility
          const approvalTxUrl = getExplorerTxUrl(chainId, approvalTx.hash)

          // Show approval confirmation
          if (commandId && this.commandCallbacks.has(commandId)) {
            const callback = this.commandCallbacks.get(commandId)!
            callback(`
## Approval Successful ✅

Your ${payWith} tokens have been approved for trading.

- Transaction hash: [${approvalTx.hash.substring(0, 10)}...${approvalTx.hash.substring(approvalTx.hash.length - 8)}](${approvalTxUrl})
- Gas used: ${approvalReceipt.gasUsed.toString()}

Now proceeding with the trade...
            `)
          }
        }
      }

      // Execute the swap
      const tx = await executeSwap(provider, quote)

      // Show transaction submitted message
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`
## Transaction Submitted

Your purchase of ${readableBuyAmount} ${tokenSymbol} is being processed on the blockchain.

Transaction hash: ${tx.hash}

Please wait while the transaction is being confirmed...
        `)
      }

      // Wait for transaction to be mined
      const receipt = await tx.wait()

      // Get transaction URL using our chain utility
      const txUrl = getExplorerTxUrl(chainId, tx.hash)

      // Show completion message
      const completionMessage = `
## Transaction Complete! ✅

Your purchase of **${readableBuyAmount} ${tokenSymbol}** with **${readableSellAmount} ${payWith}** has been successfully completed on ${chainName}.

- Transaction hash: [View TX in explorer](${txUrl})
- Gas used: ${receipt.gasUsed.toString()}
- Status: ${receipt.status === 1 ? "Success" : "Failed"}

The tokens have been added to your wallet. You can view your updated portfolio with the [show portfolio](command:Show my portfolio) command.
`

      // Call the callback if commandId is provided
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(completionMessage)
        this.commandCallbacks.delete(commandId)
      }
    } catch (apiError: any) {
      console.error("API error in buy order:", apiError)

      let errorMessage = apiError.message || "Unknown error"

      // Handle specific API errors
      if (apiError.message.includes("Network error") || apiError.message.includes("Failed to connect")) {
        errorMessage = `Error: Could not connect to the 0x API. This could be due to:
1. Network connectivity issues
2. CORS restrictions in the browser
3. The API key may be invalid or missing

Please check your connection and API key configuration. If you're testing locally, consider using a CORS proxy or testing on a deployed version.`
      }

      if (apiError.message.includes("Not Found") || apiError.message.includes("0x API error")) {
        errorMessage = `Error executing buy order: The trading API is currently unavailable for ${tokenSymbol}. This may be due to low liquidity or API limitations. Please try again later or try a different token pair.`
      }

      if (apiError.message.includes("user rejected")) {
        errorMessage = `Transaction was cancelled. You can try again when you're ready.`
      }

      // Call the callback with the error message
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`Error executing buy order: ${errorMessage}`)
        this.commandCallbacks.delete(commandId)
      } else {
        throw apiError
      }
    }
  }

  // Update the executeSellOrder method to use the updated API and chain utilities
  private async executeSellOrder(
    tokenSymbol: string,
    amount: string,
    receiveIn = "ETH",
    commandId?: string,
  ): Promise<CommandResult> {
    try {
      // Check if window and ethereum are available
      if (typeof window === "undefined" || !window.ethereum) {
        return {
          content:
            "Web3 provider not available. Please make sure you're using a browser with an Ethereum wallet extension.",
        }
      }

      // Check if 0x API key is available
      if (!process.env.NEXT_PUBLIC_0X_API_KEY) {
        return {
          content: "0x API key not found. Please add your 0x API key to the environment variables to execute trades.",
        }
      }

      // Initial response
      const initialResponse = `
## Processing Sell Order

Preparing to sell ${amount} ${tokenSymbol} for ${receiveIn}...

- Connecting to wallet
- Checking network compatibility
- Fetching token information
- Estimating trade parameters
      `

      // Return initial response and indicate that processing is continuing
      const result: CommandResult = {
        content: initialResponse,
        isProcessing: true,
        commandId,
      }

      // Continue processing in the background
      this.processSellOrder(tokenSymbol, amount, receiveIn, commandId).catch((error) => {
        console.error("Error processing sell order:", error)

        // If there's an error, provide an error message
        if (commandId && this.commandCallbacks.has(commandId)) {
          const callback = this.commandCallbacks.get(commandId)!
          callback(`Error executing sell order: ${error.message || "Unknown error"}`)
          this.commandCallbacks.delete(commandId)
        }
      })

      return result
    } catch (error: any) {
      console.error("Error in executeSellOrder:", error)
      return { content: `Error executing sell order: ${error.message || "Unknown error"}` }
    }
  }

  // New method to process sell orders asynchronously
  private async processSellOrder(
    tokenSymbol: string,
    amount: string,
    receiveIn = "ETH",
    commandId?: string,
  ): Promise<void> {
    try {
      // Initialize provider - using ethers.js v6 BrowserProvider directly
      const provider = new ethers.BrowserProvider(window.ethereum)

      // Request account access
      await window.ethereum.request({ method: "eth_requestAccounts" })

      // Get the network
      const network = await provider.getNetwork()
      const chainId = Number(network.chainId)

      // Check if the chain is supported using our chain utility
      if (!isChainSupportedForTrading(chainId)) {
        throw new Error(`Chain ID ${chainId} not supported. Please switch to Ethereum Mainnet, Base, or Base Sepolia.`)
      }

      // Get chain name using our chain utility
      const chainName = getChainName(chainId)

      // Update progress
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`
## Processing Sell Order

Connected to wallet on ${chainName}

- ✅ Connected to wallet
- ✅ Network compatibility confirmed
- Fetching token information
- Estimating trade parameters
        `)
      }

      // Get token addresses
      const sellTokenAddress = getTokenAddressBySymbol(chainId, tokenSymbol)
      const buyTokenAddress = getTokenAddressBySymbol(chainId, receiveIn)

      if (!sellTokenAddress) {
        throw new Error(`Token ${tokenSymbol} not found or not supported on ${chainName}.`)
      }

      if (!buyTokenAddress) {
        throw new Error(`Token ${receiveIn} not found or not supported on ${chainName}.`)
      }

      // Get token info for decimals
      const sellTokenInfo = getTokenInfo(chainId, sellTokenAddress)
      const buyTokenInfo = getTokenInfo(chainId, buyTokenAddress)

      if (!sellTokenInfo) {
        throw new Error(`Could not get information for token ${tokenSymbol}.`)
      }

      if (!buyTokenInfo) {
        throw new Error(`Could not get information for token ${receiveIn}.`)
      }

      // Update progress
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`
## Processing Sell Order

Connected to wallet on ${chainName}

- ✅ Connected to wallet
- ✅ Network compatibility confirmed
- ✅ Token information retrieved
- Estimating trade parameters
        `)
      }

      // Format the amount with proper decimals
      const sellAmount = formatAmount(amount, sellTokenInfo.decimals)

      console.log(`Formatted sell amount: ${sellAmount}`)

      // Check if user has sufficient balance
      const hasSufficientBalance = await checkSufficientBalance(
        provider,
        sellTokenAddress,
        this.walletAddress!,
        sellAmount,
      )

      if (!hasSufficientBalance) {
        throw new Error(
          `Insufficient balance. You need at least ${amount} ${tokenSymbol} to complete this transaction, but your balance is lower than that. Please add funds or try a smaller amount.`,
        )
      }

      // Get an executable quote directly
      const executableQuote = await getSwapQuote(chainId, {
        sellToken: sellTokenAddress,
        buyToken: buyTokenAddress,
        sellAmount: sellAmount,
        takerAddress: this.walletAddress,
        slippagePercentage: 0.01, // 1% slippage
      })

      // Calculate human-readable amounts from quote
      const sellTokenDecimals = sellTokenInfo.decimals
      const buyTokenDecimals = buyTokenInfo.decimals

      const readableSellAmount = (Number(executableQuote.sellAmount) / Math.pow(10, sellTokenDecimals)).toFixed(6)
      const readableBuyAmount = (Number(executableQuote.buyAmount) / Math.pow(10, buyTokenDecimals)).toFixed(6)

      // Update progress with quote summary
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`
## Trade Quote Summary

You are about to sell **${readableSellAmount} ${tokenSymbol}** for **${readableBuyAmount} ${receiveIn}** on ${chainName}.

- Price: 1 ${tokenSymbol} = ${Number(executableQuote.price).toFixed(6)} ${receiveIn}
- Estimated price impact: ${Number(executableQuote.estimatedPriceImpact) * 100}%
- Slippage tolerance: 1%
- Estimated gas: ${executableQuote.estimatedGas}

Checking token approval status...
        `)
      }

      // Check if token approval is needed for ERC20 tokens
      if (sellTokenAddress !== "ETH") {
        const needsApproval = !(await checkTokenAllowance(
          provider,
          sellTokenAddress,
          this.walletAddress!,
          executableQuote.allowanceTarget,
          executableQuote.sellAmount,
        ))

        if (needsApproval) {
          // Show approval message
          if (commandId && this.commandCallbacks.has(commandId)) {
            const callback = this.commandCallbacks.get(commandId)!
            callback(`
## Token Approval Required

Before executing this trade, you need to approve the 0x Protocol to spend your ${tokenSymbol} tokens.
This is a one-time approval that will allow the protocol to access your tokens for this and future trades.

Please approve the transaction in your wallet.
            `)
          }

          // Execute approval transaction
          const approvalTx = await approveTokenSpending(
            provider,
            sellTokenAddress,
            executableQuote.allowanceTarget,
            executableQuote.sellAmount,
          )

          // Wait for approval transaction to be mined
          const approvalReceipt = await approvalTx.wait()

          // Get transaction URL using our chain utility
          const approvalTxUrl = getExplorerTxUrl(chainId, approvalTx.hash)

          // Show approval confirmation
          if (commandId && this.commandCallbacks.has(commandId)) {
            const callback = this.commandCallbacks.get(commandId)!
            callback(`
## Approval Successful ✅

Your ${tokenSymbol} tokens have been approved for trading.

- Transaction hash: [${approvalTx.hash.substring(0, 10)}...${approvalTx.hash.substring(approvalTx.hash.length - 8)}](${approvalTxUrl})
- Gas used: ${approvalReceipt.gasUsed.toString()}

Now proceeding with the trade...
            `)
          }
        }
      }

      // Execute the swap
      const tx = await executeSwap(provider, executableQuote)

      // Show transaction submitted message
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`
## Transaction Submitted

Your sale of ${readableSellAmount} ${tokenSymbol} is being processed on the blockchain.

Transaction hash: ${tx.hash}

Please wait while the transaction is being confirmed...
        `)
      }

      // Wait for transaction to be mined
      const receipt = await tx.wait()

      // Get transaction URL using our chain utility
      const txUrl = getExplorerTxUrl(chainId, tx.hash)

      // Show completion message
      const completionMessage = `
## Transaction Complete! ✅

Your sale of **${readableSellAmount} ${tokenSymbol}** for **${readableBuyAmount} ${receiveIn}** has been successfully completed on ${chainName}.

- Transaction hash: [View TX in explorer](${txUrl})
- Gas used: ${receipt.gasUsed.toString()}
- Status: ${receipt.status === 1 ? "Success" : "Failed"}

The tokens have been added to your wallet. You can view your updated portfolio with the [show portfolio](command:Show my portfolio) command.
`

      // Call the callback if commandId is provided
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(completionMessage)
        this.commandCallbacks.delete(commandId)
      }
    } catch (apiError: any) {
      console.error("API error in sell order:", apiError)

      let errorMessage = apiError.message || "Unknown error"

      // Handle specific API errors
      if (apiError.message.includes("Network error") || apiError.message.includes("Failed to connect")) {
        errorMessage = `Error: Could not connect to the 0x API. This could be due to:
1. Network connectivity issues
2. CORS restrictions in the browser
3. The API key may be invalid or missing

Please check your connection and API key configuration. If you're testing locally, consider using a CORS proxy or testing on a deployed version.`
      }

      if (apiError.message.includes("Not Found") || apiError.message.includes("0x API error")) {
        errorMessage = `Error executing sell order: The trading API is currently unavailable for ${tokenSymbol}. This may be due to low liquidity or API limitations. Please try again later or try a different token pair.`
      }

      if (apiError.message.includes("user rejected")) {
        errorMessage = `Transaction was cancelled. You can try again when you're ready.`
      }

      // Call the callback with the error message
      if (commandId && this.commandCallbacks.has(commandId)) {
        const callback = this.commandCallbacks.get(commandId)!
        callback(`Error executing sell order: ${errorMessage}`)
        this.commandCallbacks.delete(commandId)
      } else {
        throw apiError
      }
    }
  }
}
