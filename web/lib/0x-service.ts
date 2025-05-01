"use client"

import { ethers } from "ethers"
import { createClient } from "@/lib/supabase/client"
import { isChainSupported, getChainById, getExplorerTxUrl, getNativeTokenAddress } from "@/lib/chain-utils"
import { apiGet } from "@/lib/api-client"
import { formatTokenAmount, formatBigIntWithDecimals } from "@/lib/token-service"

function safeBigInt(value: string | number | undefined | null, context = ""): bigint {
  if (value === undefined || value === null) {
    return BigInt(0)
  }
  try {
    return BigInt(value)
  } catch (error) {
    return BigInt(0)
  }
}

function bigIntAbs(value: bigint): bigint {
  return value < 0n ? -value : value
}

const NATIVE_ETH_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

interface SwapParams {
  sellToken: string
  buyToken: string
  sellAmount: string
  takerAddress?: string
  slippagePercentage?: number
}

interface SwapQuoteResponse {
  chainId: number
  price: string
  guaranteedPrice: string
  estimatedPriceImpact: string
  to: string
  data: string
  value: string
  gas: string
  estimatedGas: string
  gasPrice: string
  protocolFee: string
  minimumProtocolFee: string
  buyTokenAddress: string
  sellTokenAddress: string
  buyAmount: string
  sellAmount: string
  sources: any[]
  allowanceTarget: string
  decodedUniqueId: string
  sellTokenToEthRate: string
  buyTokenToEthRate: string
  expectedSlippage: string | null
  permit2?: {
    eip712: any
  }
  transaction?: {
    to: string
    data: string
    value: string
    gas: string
    gasPrice: string
  }
}

async function handleApiError(response: Response): Promise<any> {
  try {
    const errorData = await response.json()
    const errorMessage = errorData.error || errorData.message || "Unknown error"
    throw new Error(`API Error: ${errorMessage}`)
  } catch (parseError) {
    throw new Error(`API Error: Status ${response.status}`)
  }
}

export async function getSwapQuote(chainId: number, params: SwapParams): Promise<SwapQuoteResponse> {
  try {
    const queryParams = new URLSearchParams()
    const sellToken = params.sellToken === "ETH" ? NATIVE_ETH_ADDRESS : params.sellToken
    const buyToken = params.buyToken === "ETH" ? NATIVE_ETH_ADDRESS : params.buyToken

    queryParams.append("sellToken", sellToken)
    queryParams.append("buyToken", buyToken)
    queryParams.append("chainId", chainId.toString())
    queryParams.append("sellAmount", params.sellAmount)

    if (params.takerAddress) {
      queryParams.append("taker", params.takerAddress)
    }

    if (params.slippagePercentage) {
      queryParams.append("slippagePercentage", params.slippagePercentage.toString())
    }

    const url = `/api/0x-proxy?endpoint=swap/permit2/quote&${queryParams.toString()}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await apiGet(
      url,
      {
        method: "GET",
        signal: controller.signal,
      },
      "0x API",
    )

    clearTimeout(timeoutId)

    if (!response.ok) {
      return handleApiError(response)
    }

    return await response.json()
  } catch (error: any) {
    const errorMsg = error.message || "Unknown error"
    throw new Error(
      `Failed to get quote from 0x API: ${errorMsg}. This may be due to low liquidity for this token pair, API key issues, or temporary API unavailability.`,
    )
  }
}

export async function estimateSellAmount(
  chainId: number,
  sellToken: string,
  buyToken: string,
  targetBuyAmount: string,
  takerAddress?: string,
  maxIterations = 3,
): Promise<{ sellAmount: string; buyAmount: string; quote: SwapQuoteResponse }> {
  const buyTokenInfo = getTokenInfo(chainId, buyToken)
  const sellTokenInfo = getTokenInfo(chainId, sellToken)

  if (!buyTokenInfo || !sellTokenInfo) {
    throw new Error("Could not get token information for decimal conversion")
  }

  let initialPriceRatio = 1

  if (
    (buyTokenInfo.symbol === "ETH" || buyTokenInfo.symbol === "WETH") &&
    (sellTokenInfo.symbol === "USDC" || sellTokenInfo.symbol === "USDT" || sellTokenInfo.symbol === "DAI")
  ) {
    initialPriceRatio = 3500
  } else if (
    (sellTokenInfo.symbol === "ETH" || sellTokenInfo.symbol === "WETH") &&
    (buyTokenInfo.symbol === "USDC" || buyTokenInfo.symbol === "USDT" || buyTokenInfo.symbol === "DAI")
  ) {
    initialPriceRatio = 0.00029
  } else if (buyTokenInfo.symbol === "WBTC" && (sellTokenInfo.symbol === "ETH" || sellTokenInfo.symbol === "WETH")) {
    initialPriceRatio = 18
  } else if (sellTokenInfo.symbol === "WBTC" && (buyTokenInfo.symbol === "ETH" || buyTokenInfo.symbol === "WETH")) {
    initialPriceRatio = 0.055
  }

  const targetBuyAmountBigInt = safeBigInt(targetBuyAmount, "targetBuyAmount")
  const targetBuyAmountReadable = Number(targetBuyAmountBigInt) / Math.pow(10, buyTokenInfo.decimals)
  const initialSellAmountReadable = targetBuyAmountReadable * initialPriceRatio
  let currentSellAmount = BigInt(
    Math.floor(initialSellAmountReadable * Math.pow(10, sellTokenInfo.decimals)),
  ).toString()

  let bestQuote: SwapQuoteResponse | null = null
  let bestSellAmount = currentSellAmount
  let bestBuyAmount = "0"
  let iteration = 0

  while (iteration < maxIterations) {
    iteration++
    try {
      const quote = await getSwapQuote(chainId, {
        sellToken,
        buyToken,
        sellAmount: currentSellAmount,
        takerAddress,
        slippagePercentage: 0.01,
      })

      if (
        !bestQuote ||
        Math.abs(safeBigInt(quote.buyAmount, "quote.buyAmount") - safeBigInt(targetBuyAmount, "targetBuyAmount")) <
          Math.abs(safeBigInt(bestBuyAmount, "bestBuyAmount") - safeBigInt(targetBuyAmount, "targetBuyAmount"))
      ) {
        bestQuote = quote
        bestSellAmount = quote.sellAmount
        bestBuyAmount = quote.buyAmount
      }

      const buyAmountDiffBigInt = safeBigInt(
        Math.abs(
          Number(safeBigInt(quote.buyAmount, "quote.buyAmount") - safeBigInt(targetBuyAmount, "targetBuyAmount")),
        ),
        "buyAmountDiff",
      )
      const buyAmountDiff =
        Number((buyAmountDiffBigInt * BigInt(100)) / safeBigInt(targetBuyAmount, "targetBuyAmount")) / 100

      if (buyAmountDiff < 0.05) {
        return { sellAmount: quote.sellAmount, buyAmount: quote.buyAmount, quote }
      }

      if (safeBigInt(quote.buyAmount, "quote.buyAmount") < safeBigInt(targetBuyAmount, "targetBuyAmount")) {
        const ratio =
          (safeBigInt(targetBuyAmount, "targetBuyAmount") * BigInt(10000)) /
          safeBigInt(quote.buyAmount, "quote.buyAmount")
        const adjustmentFactor = Number(ratio) / 10000
        const dampedFactor = 1 + (adjustmentFactor - 1) * 0.8

        currentSellAmount = (
          (safeBigInt(currentSellAmount, "currentSellAmount") * BigInt(Math.floor(dampedFactor * 10000))) /
          BigInt(10000)
        ).toString()
      } else {
        const ratio =
          (safeBigInt(quote.buyAmount, "quote.buyAmount") * BigInt(10000)) /
          safeBigInt(targetBuyAmount, "targetBuyAmount")
        const adjustmentFactor = Number(ratio) / 10000
        const dampedFactor = 1 - (adjustmentFactor - 1) * 0.8

        currentSellAmount = (
          (safeBigInt(currentSellAmount, "currentSellAmount") * BigInt(Math.floor(dampedFactor * 10000))) /
          BigInt(10000)
        ).toString()
      }
    } catch (error) {
      if (bestQuote) {
        break
      }
      throw error
    }
  }

  if (bestQuote) {
    return { sellAmount: bestSellAmount, buyAmount: bestBuyAmount, quote: bestQuote }
  }

  throw new Error("Failed to estimate sell amount after multiple attempts")
}

export async function checkTokenAllowance(
  provider: any,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  amount: string,
): Promise<boolean> {
  if (tokenAddress === "ETH" || tokenAddress === NATIVE_ETH_ADDRESS) {
    return true
  }

  const erc20Abi = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]

  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider)
  const allowance = await tokenContract.allowance(ownerAddress, spenderAddress)

  return safeBigInt(allowance.toString(), "allowance") >= safeBigInt(amount, "amount")
}

export async function approveTokenSpending(
  provider: any,
  tokenAddress: string,
  spenderAddress: string,
  amount: string,
): Promise<any> {
  if (tokenAddress === "ETH" || tokenAddress === NATIVE_ETH_ADDRESS) {
    return null
  }

  const erc20Abi = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function symbol() view returns (string)",
  ]

  const signer = await provider.getSigner()
  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer)
  const symbol = await tokenContract.symbol()

  const maxAmount = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  const tx = await tokenContract.approve(spenderAddress, maxAmount)

  return tx
}

export async function checkSufficientBalance(
  provider: any,
  tokenAddress: string,
  ownerAddress: string,
  amount: string,
): Promise<boolean> {
  if (tokenAddress === "ETH" || tokenAddress === NATIVE_ETH_ADDRESS) {
    const balance = await provider.getBalance(ownerAddress)
    return safeBigInt(balance.toString(), "ETH balance") >= safeBigInt(amount, "amount")
  }

  const erc20Abi = [
    "function balanceOf(address owner) view returns (uint256)",
    "function symbol() view returns (string)",
  ]

  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider)
  const balance = await tokenContract.balanceOf(ownerAddress)

  return safeBigInt(balance.toString(), "token balance") >= safeBigInt(amount, "amount")
}

export async function executeSwap(provider: any, swapQuote: SwapQuoteResponse): Promise<any> {
  const signer = await provider.getSigner()
  const address = await signer.getAddress()

  const txTo = swapQuote.transaction?.to || swapQuote.to
  let txData = swapQuote.transaction?.data || swapQuote.data
  const txValue = swapQuote.transaction?.value || swapQuote.value
  const txGas = swapQuote.transaction?.gas || swapQuote.gas

  if (swapQuote.permit2?.eip712) {
    const signature = await signer.signTypedData(
      swapQuote.permit2.eip712.domain,
      swapQuote.permit2.eip712.types,
      swapQuote.permit2.eip712.message,
    )

    const signatureBytes = ethers.getBytes(signature)
    const signatureLength = signatureBytes.length
    const signatureLengthHex = ethers.toBeHex(signatureLength, 32)
    txData = ethers.concat([txData, signatureLengthHex, signature])
  }

  const tx = {
    from: address,
    to: txTo,
    data: txData,
    value: txValue,
    gasLimit: txGas ? BigInt(txGas) : undefined,
  }

  return await signer.sendTransaction(tx)
}

export function getTokenAddressBySymbol(chainId: number, symbol: string): string | null {
  const chain = getChainById(chainId)
  if (!chain) return null

  const upperSymbol = symbol.toUpperCase()
  if (upperSymbol === "ETH" || upperSymbol === chain.nativeCurrency.symbol.toUpperCase()) {
    return getNativeTokenAddress(chainId)
  }

  const tokenAddress = chain.tokens?.[upperSymbol]
  if (tokenAddress) {
    return tokenAddress
  }

  return null
}

export async function getTokenAddressBySymbolFromDB(chainId: number, symbol: string): Promise<string | null> {
  try {
    const supabase = createClient()
    const normalizedSymbol = symbol.toUpperCase()

    const { data, error } = await supabase
      .from("token_metadata")
      .select("contract_address")
      .eq("chain_id", chainId)
      .ilike("ticker", normalizedSymbol)
      .limit(1)

    if (error || !data || data.length === 0) {
      return null
    }

    return data[0].contract_address
  } catch (error) {
    return null
  }
}

export function getTokenInfo(chainId: number, tokenAddress: string): { symbol: string; decimals: number } | null {
  const chain = getChainById(chainId)
  if (!chain) return null

  if (tokenAddress === "ETH" || tokenAddress === NATIVE_ETH_ADDRESS) {
    return {
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
    }
  }

  const tokenInfo = chain.tokenInfo?.[tokenAddress.toLowerCase()]
  if (tokenInfo) {
    return tokenInfo
  }

  const commonTokens: Record<string, { symbol: string; decimals: number }> = {
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": { symbol: "WETH", decimals: 18 },
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": { symbol: "USDC", decimals: 6 },
    "0xdAC17F958D2ee523a2206206994597C13D831ec7": { symbol: "USDT", decimals: 6 },
    "0x6B175474E89094C44Da98b954EedeAC495271d0F": { symbol: "DAI", decimals: 18 },
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": { symbol: "WBTC", decimals: 8 },
    "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": { symbol: "USDC", decimals: 6 },
    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb": { symbol: "DAI", decimals: 18 },
    "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22": { symbol: "CBETH", decimals: 18 },
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e": { symbol: "USDC", decimals: 6 },
    "0x7D49a065D17d6d4a5E9d1b4E23E0Bf02A2Ab5d98": { symbol: "DAI", decimals: 18 },
    "0x28D7a32f2fBE2B12ea7e5116c4D2bAa06F8d1EB7": { symbol: "WBTC", decimals: 8 },
  }

  if (tokenAddress.toLowerCase() in commonTokens) {
    return commonTokens[tokenAddress.toLowerCase()]
  }

  return null
}

export function formatAmount(amount: string | number, decimals: number): string {
  return formatTokenAmount(amount, decimals)
}

export function formatBigIntWithDecimalsFormatted(amount: bigint | string, decimals: number): string {
  return formatBigIntWithDecimals(amount, decimals)
}

export function isChainSupportedForTrading(chainId: number): boolean {
  return isChainSupported(chainId)
}

export function getTransactionUrl(chainId: number, txHash: string): string {
  return getExplorerTxUrl(chainId, txHash)
}
