"use client"

import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// Global client instance
let supabaseClient: ReturnType<typeof createSupabaseClient> | null = null

export function createClient() {
  // If we already have a client, return it
  if (supabaseClient) return supabaseClient

  // Get environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Add detailed logging
  console.log("Debug - Raw Supabase URL:", supabaseUrl)
  console.log("Debug - Raw Supabase Key:", supabaseAnonKey ? "[REDACTED]" : "undefined")

  // Check for placeholder values
  if (supabaseUrl === "your_supabase_url") {
    console.error("Found placeholder 'your_supabase_url' instead of actual URL")
    throw new Error(
      "Supabase URL is set to a placeholder value. Please set the actual URL in your environment variables.",
    )
  }

  // Basic validation of environment variables
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase URL or anonymous key is missing")
    throw new Error("Supabase URL or anonymous key is missing")
  }

  try {
    // Create the client without any URL validation
    console.log("Creating Supabase client with URL:", supabaseUrl)
    supabaseClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
    console.log("Supabase client created successfully")
    return supabaseClient
  } catch (error) {
    console.error("Error creating Supabase client:", error)
    throw error
  }
}
