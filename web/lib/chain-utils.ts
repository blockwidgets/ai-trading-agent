"use client"

import { base, baseSepolia, mainnet } from "wagmi/chains"

export const chains = {
  ethereum: mainnet,
  base: base,
  baseSepolia: baseSepolia,
}

export const SUPPORTED_CHAIN_IDS = [mainnet.id, base.id, baseSepolia.id]
export const DEFAULT_CHAIN = base

export function getChainById(chainId: number) {
  switch (chainId) {
    case mainnet.id:
      return chains.ethereum
    case base.id:
      return chains.base
    case baseSepolia.id:
      return chains.baseSepolia
    default:
      return chains.base
  }
}

export function isChainSupported(chainId: number): boolean {
  return SUPPORTED_CHAIN_IDS.includes(chainId)
}

export function getChainName(chainId: number): string {
  const chain = getChainById(chainId)
  return chain.name
}

export function getChainColor(chainId: number): string {
  switch (chainId) {
    case mainnet.id:
      return "#627EEA"
    case base.id:
      return "#0052FF"
    case baseSepolia.id:
      return "#6F4CFF"
    default:
      return "#0052FF"
  }
}

export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const chain = getChainById(chainId)
  return `${chain.blockExplorers.default.url}/tx/${txHash}`
}

export function getExplorerAddressUrl(chainId: number, address: string): string {
  const chain = getChainById(chainId)
  return `${chain.blockExplorers.default.url}/address/${address}`
}

export function getExplorerTokenUrl(chainId: number, tokenAddress: string): string {
  const chain = getChainById(chainId)
  return `${chain.blockExplorers.default.url}/token/${tokenAddress}`
}

export function getChainIcon(chainId: number): string {
  switch (chainId) {
    case mainnet.id:
      return "/icons/ethereum.svg"
    case base.id:
      return "/icons/base.svg"
    case baseSepolia.id:
      return "/icons/base-sepolia.svg"
    default:
      return "/icons/base.svg"
  }
}

export function getRpcUrl(chainId: number): string {
  const chain = getChainById(chainId)
  return chain.rpcUrls.default.http[0]
}

export function getNativeCurrencySymbol(chainId: number): string {
  const chain = getChainById(chainId)
  return chain.nativeCurrency.symbol
}

export function getNativeCurrencyDecimals(chainId: number): number {
  const chain = getChainById(chainId)
  return chain.nativeCurrency.decimals
}

export function getChainByName(name: string): typeof mainnet | typeof base | typeof baseSepolia {
  const normalizedName = name.toLowerCase()

  if (normalizedName.includes("ethereum") || normalizedName === "eth" || normalizedName === "mainnet") {
    return chains.ethereum
  } else if (normalizedName.includes("base") && !normalizedName.includes("sepolia")) {
    return chains.base
  } else if (normalizedName.includes("sepolia") || normalizedName.includes("testnet")) {
    return chains.baseSepolia
  }

  return DEFAULT_CHAIN
}

export function getNativeTokenAddress(chainId: number): string {
  return "ETH"
}
