import { type NextRequest, NextResponse } from "next/server"
import { isChainSupported } from "@/lib/chain-utils"

export const runtime = "nodejs"

// 0x API base URL
const API_BASE_URL = "https://api.0x.org"

export async function GET(request: NextRequest) {
  try {
    // Get the endpoint and chainId from the query parameters
    const searchParams = request.nextUrl.searchParams
    const endpoint = searchParams.get("endpoint")
    const chainIdParam = searchParams.get("chainId")

    // Validate required parameters
    if (!endpoint || !chainIdParam) {
      return NextResponse.json({ error: "Missing required parameters: endpoint and chainId" }, { status: 400 })
    }

    const chainId = Number.parseInt(chainIdParam)

    // Validate that the chain is supported
    if (!isChainSupported(chainId)) {
      return NextResponse.json({ error: `Chain ID ${chainId} is not supported` }, { status: 400 })
    }

    // Clean up the endpoint (remove any leading/trailing slashes)
    const cleanEndpoint = endpoint.replace(/^\/+|\/+$/g, "")

    // Build the query parameters
    const queryParams = new URLSearchParams()

    // Copy all other parameters from the request
    for (const [key, value] of searchParams.entries()) {
      if (key !== "endpoint" && key !== "chainId") {
        // Ensure we're not sending empty or invalid values
        if (value && value.trim() !== "") {
          queryParams.append(key, value)
        }
      }
    }

    // Add chainId to query parameters
    queryParams.append("chainId", chainId.toString())

    // Construct the URL to the 0x API
    const url = `${API_BASE_URL}/${cleanEndpoint}?${queryParams.toString()}`

    console.log(`Proxying request to: ${url}`)

    // Get the API key from environment variables
    const apiKey = process.env.NEXT_PUBLIC_0X_API_KEY

    // Check if API key is available
    if (!apiKey) {
      console.warn("0x API key is missing. This will cause authentication issues.")
      return NextResponse.json(
        {
          error: "0x API key is not configured",
          details: "Please add your 0x API key to the NEXT_PUBLIC_0X_API_KEY environment variable.",
        },
        { status: 401 },
      )
    }

    // Prepare headers according to 0x API documentation for v2
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      "0x-api-key": apiKey,
      "0x-version": "v2",
    }

    console.log(`Using headers: ${JSON.stringify({ "Content-Type": "application/json", "0x-version": "v2" }, null, 2)}`)

    // Make the request to the 0x API with retry logic
    let response: Response | null = null
    let retries = 3
    let delay = 500

    while (retries > 0) {
      try {
        response = await fetch(url, {
          method: "GET",
          headers,
          // Add a timeout to prevent hanging requests
          signal: AbortSignal.timeout(15000), // 15 second timeout
        })

        // If successful or not a retryable error, break out of the loop
        if (response.ok || (response.status !== 429 && response.status < 500)) {
          break
        }

        // If we get a rate limit or server error, retry
        console.warn(`0x API request failed with status ${response.status}, retrying after ${delay}ms...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= 2 // Exponential backoff
        retries--
      } catch (error) {
        console.error("Fetch error:", error)
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
          delay *= 2
          retries--
        } else {
          throw error
        }
      }
    }

    if (!response) {
      return NextResponse.json({ error: "Failed to connect to 0x API after multiple attempts" }, { status: 502 })
    }

    // Log response status
    console.log(`0x API response status: ${response.status}`)

    // Handle error responses
    if (!response.ok) {
      const errorText = await response.text()
      let errorData

      try {
        // Try to parse as JSON
        errorData = JSON.parse(errorText)
      } catch (e) {
        // If not JSON, use the raw text
        errorData = { message: errorText }
      }

      // Create a detailed error response
      const errorResponse = {
        status: response.status,
        statusText: response.statusText,
        url,
        errorData,
        apiKeyProvided: !!apiKey,
      }

      console.error("Error from 0x API:", errorResponse)

      // Special handling for authentication errors
      if (response.status === 403) {
        return NextResponse.json(
          {
            error: "Authentication failed with 0x API. Your API key may be invalid or expired.",
            details:
              "Please check your 0x API key or get a new one from https://0x.org/docs/introduction/getting-started",
          },
          { status: 403 },
        )
      }

      // Return a more detailed error
      return NextResponse.json(
        {
          error: `0x API error: ${response.status} ${response.statusText}`,
          details: errorResponse,
        },
        { status: response.status },
      )
    }

    // Get the response data
    const data = await response.json()

    // Return the response
    return NextResponse.json(data, { status: response.status })
  } catch (error: any) {
    console.error("Error in 0x API proxy:", error)

    // Provide more specific error messages based on the error type
    if (error.name === "AbortError") {
      return NextResponse.json(
        { error: "Request to 0x API timed out. The service might be experiencing high load or connectivity issues." },
        { status: 504 },
      )
    }

    if (error.name === "TypeError" && error.message.includes("fetch")) {
      return NextResponse.json(
        { error: "Network error while connecting to 0x API. Please check your internet connection." },
        { status: 502 },
      )
    }

    return NextResponse.json(
      { error: error.message || "An error occurred while proxying the request" },
      { status: 500 },
    )
  }
}
