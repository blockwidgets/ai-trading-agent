import { OpenAIStream, StreamingTextResponse } from "ai"
import OpenAI from "openai"
import { fetchWalletTokens, getPortfolioSummary } from "@/lib/portfolio-service"
import { getTokenInfoByTicker } from "@/lib/token-price-service"
import { getChainByName, DEFAULT_CHAIN } from "@/lib/chain-utils"
import { FunctionHandler } from "@/lib/ai-functions/function-handler"

export const runtime = "nodejs"

// Create an OpenAI API client (that's edge friendly!)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  try {
    // Validate that we have an OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set")
      return new Response(JSON.stringify({ error: "OpenAI API key is not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Parse the request body
    const body = await req.json()
    const { messages, userId, walletAddress } = body

    // Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid messages format" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Get the last message from the user
    const lastMessage = messages[messages.length - 1]
    const userInput = lastMessage.content.toLowerCase()

    // Check if this is a market info request
    const priceRegex = /(?:price|market|how much is|what is the price of|what's the price of)\s+([a-zA-Z]{2,10})/i
    const priceMatch = userInput.match(priceRegex)

    if (priceMatch && priceMatch[1]) {
      const tokenSymbol = priceMatch[1].toUpperCase()
      console.log(`Detected market info request for ${tokenSymbol}`)

      try {
        // Get token info from the token price service
        const tokenInfo = await getTokenInfoByTicker(tokenSymbol, DEFAULT_CHAIN.id)

        if (tokenInfo && tokenInfo.price) {
          // Format the market info response
          const marketInfo = `
## ${tokenSymbol} Market Information

**Current Price:** $${tokenInfo.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
${tokenInfo.marketCap && tokenInfo.marketCap > 0 ? `**Market Cap:** $${(tokenInfo.marketCap / 1e9).toFixed(2)}B` : ""}
**Chain:** ${getChainByName(DEFAULT_CHAIN.id).name}
${tokenInfo.contractAddress ? `**Contract:** \`${tokenInfo.contractAddress}\`` : ""}

### Trading Actions
- Buy ${tokenSymbol}: [Buy ${tokenSymbol}](command:Buy 0.1 ${tokenSymbol} with ETH)
- Sell ${tokenSymbol}: [Sell ${tokenSymbol}](command:Sell 0.1 ${tokenSymbol} for ETH)
          `

          // Create an assistant message with the market info
          const marketInfoMessage = {
            role: "assistant",
            content: marketInfo,
          }

          // Return the market info as a stream
          return new Response(JSON.stringify({ message: marketInfoMessage }), {
            headers: { "Content-Type": "application/json" },
          })
        }
      } catch (error) {
        console.error(`Error fetching market info for ${tokenSymbol}:`, error)
        // Continue with normal processing if market info fails
      }
    }

    // Initialize function handler
    const functionHandler = new FunctionHandler(walletAddress)
    const commandId = `cmd-${Date.now()}`

    // Check for trading intent patterns
    const buyPattern = /(?:buy|purchase)\s+(\d*\.?\d+)\s+([a-zA-Z]{2,10})(?:\s+(?:with|using|for)\s+([a-zA-Z]{2,10}))?/i
    const sellPattern = /(?:sell|trade)\s+(\d*\.?\d+)\s+([a-zA-Z]{2,10})(?:\s+(?:for|to get)\s+([a-zA-Z]{2,10}))?/i
    const portfolioPattern = /(?:show|view|display|check|my)\s+(?:portfolio|holdings|assets|tokens|wallet)/i
    const analyzePattern = /(?:analyze|analysis|evaluate|assess)\s+(?:my\s+)?portfolio/i
    const recommendPattern = /(?:recommend|suggestion|advice|what\s+should\s+i\s+(?:buy|sell|do))/i

    // Check for trading intents and execute functions directly
    let functionCall = null
    let functionArgs = {}

    if (buyPattern.test(userInput)) {
      const match = userInput.match(buyPattern)
      if (match) {
        const [_, amount, tokenSymbol, payWith = "ETH"] = match
        functionCall = "buyToken"
        functionArgs = {
          tokenSymbol: tokenSymbol.toUpperCase(),
          amount,
          payWith: payWith.toUpperCase(),
        }
      }
    } else if (sellPattern.test(userInput)) {
      const match = userInput.match(sellPattern)
      if (match) {
        const [_, amount, tokenSymbol, receiveIn = "ETH"] = match
        functionCall = "sellToken"
        functionArgs = {
          tokenSymbol: tokenSymbol.toUpperCase(),
          amount,
          receiveIn: receiveIn.toUpperCase(),
        }
      }
    } else if (portfolioPattern.test(userInput)) {
      functionCall = "getPortfolio"
    } else if (analyzePattern.test(userInput)) {
      functionCall = "analyzePortfolio"
    } else if (recommendPattern.test(userInput)) {
      functionCall = "getRecommendations"
    }

    // If we detected a function call, execute it directly
    if (functionCall) {
      try {
        console.log(`Executing function ${functionCall} with args:`, functionArgs)
        const result = await functionHandler.handleFunctionCall(functionCall, functionArgs, commandId)

        // Return the result directly
        return new Response(
          JSON.stringify({
            message: {
              role: "assistant",
              content: result.content,
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        )
      } catch (error) {
        console.error(`Error executing function ${functionCall}:`, error)
        // Continue with normal processing if function execution fails
      }
    }

    // Fetch portfolio data if available
    let portfolioContext = ""
    if (walletAddress) {
      try {
        const portfolioData = await fetchWalletTokens(walletAddress)

        // Generate portfolio summary for AI context
        portfolioContext = `
User's wallet address: ${walletAddress}
${getPortfolioSummary(portfolioData)}

Detailed Holdings:
${portfolioData
  .map(
    (token) =>
      `- ${token.symbol} (${token.chainName}): ${token.balance} tokens worth $${token.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  )
  .join("\n")}

Market Context:
- ETH is the native token of Ethereum, used for gas fees and as a store of value
- WETH is wrapped ETH, an ERC-20 compatible version of ETH
- USDC, USDT, and DAI are popular stablecoins pegged to the US dollar
- WBTC is wrapped Bitcoin, allowing BTC exposure on Ethereum
- Base is an Ethereum L2 scaling solution built by Coinbase
- Base Sepolia is a testnet for Base, used for testing without real value
`
      } catch (error) {
        console.error("Error fetching portfolio data:", error)
        portfolioContext = "Unable to fetch portfolio data at this time."
      }
    }

    // Create a system message with context about the trading agent
    const systemPrompt = `You are an AI Trading Agent specialized in cryptocurrency trading on Ethereum, Base, and Base Sepolia blockchains.

${portfolioContext}

Your capabilities:
1. Analyze the user's portfolio and provide insights
2. Offer investment advice based on the user's holdings
3. Explain cryptocurrency concepts and market trends
4. Suggest trading strategies specifically for Ethereum, Base, and Base Sepolia chains
5. Execute trades using the 0x Protocol

When users express trading intent in natural language, suggest the appropriate command.
For example:
- If user says "I want to buy 0.1 ETH with USDC", suggest: "[Buy ETH](command:Buy ETH 0.1 USDC)"
- If user says "Sell my WBTC for ETH", suggest: "[Sell WBTC](command:Sell WBTC 0.001 ETH)"
- If user asks "What's in my wallet?", suggest: "[View Portfolio](command:Show my portfolio)"

Focus areas:
- Only discuss and recommend tokens on Ethereum, Base, and Base Sepolia chains
- Prioritize major tokens like ETH, WETH, USDC, DAI, WBTC on Ethereum
- For Base chain, focus on ETH, WETH, USDC, DAI, and cbETH
- For Base Sepolia testnet, focus on ETH, WETH, USDC, DAI, and WBTC
- Explain the benefits of using Base for lower gas fees compared to Ethereum mainnet
- Highlight that Base Sepolia is a testnet for testing transactions without real value
- Recommend Base Sepolia for users who want to test trading functionality without using real funds

When giving investment advice:
- Always consider the user's current portfolio
- Explain your reasoning
- Mention risks and potential rewards
- Avoid making specific price predictions
- Remind users that this is not financial advice
- Consider gas costs when recommending transactions, especially on Ethereum mainnet

IMPORTANT: When making recommendations, always format them as clickable commands like "[Buy ETH](command:Buy ETH 0.01 USDC)" or "[Sell WBTC](command:Sell WBTC 0.001 ETH)" so the user can easily execute them with a click.

Keep responses concise and focused on Ethereum, Base, and Base Sepolia chain tokens.

IMPORTANT: For market price information, you have access to real-time data. When users ask about token prices, provide the current price, market cap, and other relevant information.`

    try {
      // Create the messages array with the system prompt
      const apiMessages = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...messages,
      ]

      // Use the OpenAI API directly with the official client
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: apiMessages,
        stream: true,
      })

      // Convert the response to a stream
      const stream = OpenAIStream(response)

      // Return a StreamingTextResponse, which sets the correct headers
      return new StreamingTextResponse(stream)
    } catch (aiError) {
      console.error("OpenAI API error:", aiError)
      return new Response(JSON.stringify({ error: `OpenAI API error: ${aiError.message || aiError}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }
  } catch (error) {
    console.error("Error in chat API:", error)
    return new Response(JSON.stringify({ error: `Error processing your request: ${error.message || error}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
