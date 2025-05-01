import { CommandParser } from "@/lib/command-parser"
import type { BuyTokenParams, SellTokenParams, GetMarketInfoParams, FunctionCallResult } from "./function-schemas"

/**
 * Service to handle function calls from OpenAI
 */
export class FunctionHandler {
  private commandParser: CommandParser

  constructor(walletAddress: string | undefined) {
    this.commandParser = new CommandParser(walletAddress)
  }

  /**
   * Handle a function call from OpenAI
   * @param functionName The name of the function to call
   * @param params The parameters for the function
   * @param commandId Optional command ID for tracking async operations
   * @returns The result of the function call
   */
  async handleFunctionCall(functionName: string, params: any, commandId?: string): Promise<FunctionCallResult> {
    console.log(`Handling function call: ${functionName}`, params)

    try {
      switch (functionName) {
        case "getPortfolio":
          return await this.commandParser.getPortfolioSummary()

        case "buyToken":
          const buyParams = params as BuyTokenParams
          return await this.commandParser.executeBuyOrder(
            buyParams.tokenSymbol,
            buyParams.amount,
            buyParams.payWith || "ETH",
            commandId,
          )

        case "sellToken":
          const sellParams = params as SellTokenParams
          return await this.commandParser.executeSellOrder(
            sellParams.tokenSymbol,
            sellParams.amount,
            sellParams.receiveIn || "ETH",
            commandId,
          )

        case "getMarketInfo":
          const marketParams = params as GetMarketInfoParams
          let tokenSymbol = marketParams.tokenSymbol

          // If chain is specified, append it to the token symbol
          if (marketParams.chain) {
            tokenSymbol = `${tokenSymbol} ON ${marketParams.chain}`
          }

          return await this.commandParser.getMarketInfo(tokenSymbol, commandId)

        case "analyzePortfolio":
          return await this.commandParser.analyzePortfolio()

        case "getRecommendations":
          return await this.commandParser.getRecommendations(commandId)

        default:
          return {
            content: `Unknown function: ${functionName}. Please try a different command.`,
          }
      }
    } catch (error) {
      console.error(`Error handling function call ${functionName}:`, error)
      return {
        content: `Error executing ${functionName}: ${error.message || "Unknown error"}`,
      }
    }
  }

  /**
   * Register a callback for a specific command ID
   * @param commandId The unique ID for the command
   * @param callback The callback to call when the command completes
   */
  registerCallback(commandId: string, callback: (result: string) => void): void {
    this.commandParser.registerCallback(commandId, callback)
  }

  /**
   * Unregister a callback for a specific command ID
   * @param commandId The unique ID for the command
   */
  unregisterCallback(commandId: string): void {
    this.commandParser.unregisterCallback(commandId)
  }
}
