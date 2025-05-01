import { createClient as createSupabaseClient } from "@supabase/supabase-js"

export function createClient() {
  // Get environment variables
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Add detailed logging
  console.log("Server - Raw Supabase URL:", supabaseUrl)
  console.log("Server - Supabase Service Key:", supabaseServiceKey ? "Set" : "Not set")

  // Check for placeholder values
  if (supabaseUrl === "your_supabase_url") {
    console.error("Server - Found placeholder 'your_supabase_url' instead of actual URL")
    throw new Error(
      "Supabase URL is set to a placeholder value. Please set the actual URL in your environment variables.",
    )
  }

  // Validate environment variables
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase URL or service role key is missing")
  }

  try {
    // Create the client without URL validation
    return createSupabaseClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  } catch (error) {
    console.error("Error creating Supabase client:", error)
    throw error
  }
}
