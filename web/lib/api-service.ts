async function respectRateLimit(lastApiCall: number, API_DELAY: number): Promise<number> {
  const now = Date.now()
  const timeSinceLastCall = now - lastApiCall
  let appliedDelay = 0

  if (timeSinceLastCall < API_DELAY) {
    appliedDelay = API_DELAY - timeSinceLastCall
    await new Promise((resolve) => setTimeout(resolve, appliedDelay))
  }

  return appliedDelay
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
  backoff = 500,
  rateLimit = 0,
  lastApiCallRef?: { current: number },
): Promise<Response> {
  try {
    if (rateLimit > 0 && lastApiCallRef) {
      await respectRateLimit(lastApiCallRef.current, rateLimit)
    }

    const response = await fetch(url, options)

    if (response.status === 429 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoff))
      return fetchWithRetry(url, options, retries - 1, backoff * 2, rateLimit, lastApiCallRef)
    }

    if (lastApiCallRef) {
      lastApiCallRef.current = Date.now()
    }

    return response
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoff))
      return fetchWithRetry(url, options, retries - 1, backoff * 2, rateLimit, lastApiCallRef)
    }
    throw error
  }
}

import { handleApiResponse } from "@/lib/api-client"

// Re-export the shared functions for backward compatibility
export { respectRateLimit, handleApiResponse }

// Export the old handleApiError function for backward compatibility
export async function handleApiError(response: Response): Promise<any> {
  try {
    const errorData = await response.json()
    throw new Error(errorData.error || `API error: ${response.statusText}`)
  } catch (e) {
    throw new Error(`API error: ${response.statusText}`)
  }
}
