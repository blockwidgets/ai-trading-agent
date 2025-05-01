/**
 * Shared API client with standardized error handling and retry logic
 */

// Global rate limiting settings
const DEFAULT_RETRY_COUNT = 3
const DEFAULT_BACKOFF_MS = 500
const DEFAULT_TIMEOUT_MS = 15000

// Track API call timestamps for rate limiting
interface RateLimitTracker {
  [endpoint: string]: number
}

const lastApiCalls: RateLimitTracker = {}

/**
 * Helper function to respect rate limits
 * @param endpoint The API endpoint or category to rate limit
 * @param delayMs Minimum delay between calls in milliseconds
 * @returns The actual delay applied in milliseconds
 */
export async function respectRateLimit(endpoint: string, delayMs: number): Promise<number> {
  const now = Date.now()
  const lastCall = lastApiCalls[endpoint] || 0
  const timeSinceLastCall = now - lastCall
  let appliedDelay = 0

  if (timeSinceLastCall < delayMs) {
    appliedDelay = delayMs - timeSinceLastCall
    await new Promise((resolve) => setTimeout(resolve, appliedDelay))
  }

  lastApiCalls[endpoint] = Date.now()
  return appliedDelay
}

/**
 * Fetch with retry logic and rate limiting
 * @param url The URL to fetch
 * @param options Fetch options
 * @param retries Number of retries on failure
 * @param backoffMs Initial backoff time in milliseconds
 * @param rateLimitMs Rate limit in milliseconds
 * @param rateLimitKey Key to use for rate limiting
 * @returns The fetch response
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = DEFAULT_RETRY_COUNT,
  backoffMs = DEFAULT_BACKOFF_MS,
  rateLimitMs = 0,
  rateLimitKey = "default",
): Promise<Response> {
  try {
    // Apply rate limiting if specified
    if (rateLimitMs > 0) {
      await respectRateLimit(rateLimitKey, rateLimitMs)
    }

    // Add timeout to prevent hanging requests
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options.signal ? undefined : DEFAULT_TIMEOUT_MS)

    const fetchOptions = {
      ...options,
      signal: options.signal || controller.signal,
    }

    const response = await fetch(url, fetchOptions)
    clearTimeout(timeoutId)

    // Handle rate limiting (429) or server errors (5xx)
    if ((response.status === 429 || (response.status >= 500 && response.status < 600)) && retries > 0) {
      console.warn(`Request failed with status ${response.status}, retrying after ${backoffMs}ms...`)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      return fetchWithRetry(url, options, retries - 1, backoffMs * 2, rateLimitMs, rateLimitKey)
    }

    return response
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS}ms`)
    }

    if (retries > 0) {
      console.warn(`Fetch error: ${error.message}, retrying after ${backoffMs}ms...`)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      return fetchWithRetry(url, options, retries - 1, backoffMs * 2, rateLimitMs, rateLimitKey)
    }

    throw error
  }
}

/**
 * Handle API errors consistently
 * @param response The fetch response
 * @param context Optional context for the error
 * @returns Parsed JSON response if successful
 * @throws Error with details if the response is not OK
 */
export async function handleApiResponse<T = any>(response: Response, context = ""): Promise<T> {
  if (!response.ok) {
    let errorMessage = `API error: ${response.status} ${response.statusText}`

    try {
      const errorData = await response.json()
      errorMessage = errorData.error || errorData.message || errorMessage
    } catch (e) {
      // If we can't parse JSON, use text content
      try {
        const errorText = await response.text()
        if (errorText) {
          errorMessage = `API error: ${errorText}`
        }
      } catch (textError) {
        // If we can't get text either, use the original error message
      }
    }

    if (context) {
      errorMessage = `${context}: ${errorMessage}`
    }

    throw new Error(errorMessage)
  }

  return await response.json()
}

/**
 * Make a GET request with retry logic
 * @param url The URL to fetch
 * @param options Additional fetch options
 * @param context Context for error messages
 * @returns Parsed JSON response
 */
export async function apiGet<T = any>(url: string, options: RequestInit = {}, context = ""): Promise<T> {
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  })

  return handleApiResponse<T>(response, context)
}

/**
 * Make a POST request with retry logic
 * @param url The URL to fetch
 * @param data The data to send
 * @param options Additional fetch options
 * @param context Context for error messages
 * @returns Parsed JSON response
 */
export async function apiPost<T = any>(url: string, data: any, options: RequestInit = {}, context = ""): Promise<T> {
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(data),
    ...options,
  })

  return handleApiResponse<T>(response, context)
}
