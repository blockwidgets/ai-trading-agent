/**
 * Function schemas for OpenAI function calling
 * These define the structure and parameters for each command the AI can execute
 */

export const functionSchemas = [
  {
    name: "getPortfolio",
    description: "Fetch and display the user's cryptocurrency portfolio across different chains",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "buyToken",
    description: "Execute a buy order for a cryptocurrency token",
    parameters: {
      type: "object",
      properties: {
        tokenSymbol: {
          type: "string",
          description: "Symbol of the token to buy (e.g., ETH, WBTC, USDC)",
        },
        amount: {
          type: "string",
          description: "Amount of tokens to buy (e.g., '0.1', '100')",
        },
        payWith: {
          type: "string",
          description: "Token to pay with (e.g., USDC, ETH)",
          default: "ETH",
        },
      },
      required: ["tokenSymbol", "amount"],
    },
  },
  {
    name: "sellToken",
    description: "Execute a sell order for a cryptocurrency token",
    parameters: {
      type: "object",
      properties: {
        tokenSymbol: {
          type: "string",
          description: "Symbol of the token to sell (e.g., ETH, WBTC)",
        },
        amount: {
          type: "string",
          description: "Amount of tokens to sell (e.g., '0.1', '100')",
        },
        receiveIn: {
          type: "string",
          description: "Token to receive (e.g., USDC, ETH)",
          default: "ETH",
        },
      },
      required: ["tokenSymbol", "amount"],
    },
  },
  {
    name: "getMarketInfo",
    description: "Get market information for a specific token including price, contract address, and trading actions",
    parameters: {
      type: "object",
      properties: {
        tokenSymbol: {
          type: "string",
          description: "Symbol of the token to get information about (e.g., ETH, WBTC)",
        },
        chain: {
          type: "string",
          description: "Blockchain to query (e.g., Ethereum, Base, Base Sepolia)",
          enum: ["Ethereum", "Base", "Base Sepolia"],
          default: "Base",
        },
      },
      required: ["tokenSymbol"],
    },
  },
  {
    name: "analyzePortfolio",
    description: "Analyze the user's portfolio and provide insights on diversification, risk, and recommendations",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "getRecommendations",
    description: "Get AI-powered trading recommendations based on the user's portfolio and market conditions",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
]

// Define types for function parameters
export type GetPortfolioParams = {}

export interface BuyTokenParams {
  tokenSymbol: string
  amount: string
  payWith?: string
}

export interface SellTokenParams {
  tokenSymbol: string
  amount: string
  receiveIn?: string
}

export interface GetMarketInfoParams {
  tokenSymbol: string
  chain?: string
}

export type AnalyzePortfolioParams = {}

export type GetRecommendationsParams = {}

// Union type for all function parameters
export type FunctionParams =
  | GetPortfolioParams
  | BuyTokenParams
  | SellTokenParams
  | GetMarketInfoParams
  | AnalyzePortfolioParams
  | GetRecommendationsParams

// Type for function call result
export interface FunctionCallResult {
  content: string
  isProcessing?: boolean
  commandId?: string
}
