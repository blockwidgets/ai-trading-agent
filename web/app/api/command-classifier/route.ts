import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"

export const runtime = "nodejs"

export async function POST(req: Request) {
  try {
    const { input } = await req.json()

    if (!input || typeof input !== "string") {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Define the system prompt to classify commands
    const systemPrompt = `You are a command classifier for a crypto trading assistant. 
Your job is to determine if a user's input should be treated as a command and convert it to the appropriate slash command format.

Available commands:
1. /portfolio - View portfolio summary
2. /analyze portfolio - Analyze the portfolio and provide insights
3. /buy [token] [amount] [payWith] - Execute a buy order (e.g., /buy ETH 0.1 USDC)
4. /sell [token] [amount] [receiveIn] - Execute a sell order (e.g., /sell WBTC 0.01 ETH)
5. /market [token] - Get market information about a token
6. /recommend - Get trading recommendations

Examples of natural language that should be converted to commands:
- "Show my portfolio" → /portfolio
- "What's in my wallet" → /portfolio
- "Analyze my holdings" → /analyze portfolio
- "Buy 0.1 ETH with USDC" → /buy ETH 0.1 USDC
- "I want to purchase 10 LINK using ETH" → /buy LINK 10 ETH
- "Sell 0.01 WBTC for ETH" → /sell WBTC 0.01 ETH
- "What's the price of ETH?" → /market ETH
- "Price of WBTC" → /market WBTC
- "ETH price" → /market ETH
- "What should I invest in?" → /recommend

ONLY respond with a JSON object with two fields:
1. "isCommand": true if the input should be treated as a command, false otherwise
2. "command": the slash command if isCommand is true, null otherwise

DO NOT include any explanations or additional text.`

    // Generate the classification
    const { text } = await generateText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      prompt: input,
      temperature: 0.1, // Low temperature for more consistent results
      maxTokens: 100, // We only need a short response
    })

    // Parse the response as JSON
    try {
      const result = JSON.parse(text)
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      })
    } catch (parseError) {
      console.error("Error parsing AI response:", parseError)
      console.log("Raw AI response:", text)

      // Fallback response
      return new Response(
        JSON.stringify({
          isCommand: false,
          command: null,
          error: "Failed to parse AI response",
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      )
    }
  } catch (error) {
    console.error("Error in command classifier:", error)
    return new Response(
      JSON.stringify({
        error: "Error processing request",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    )
  }
}
