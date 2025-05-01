"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { useChat } from "ai/react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Bot, Send, User, History, DollarSign, BarChart3, TrendingUp, Search, Zap, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useToast } from "@/components/ui/use-toast"
import { fetchWithRetry, handleApiError } from "@/lib/api-service"

interface ChatInterfaceProps {
  userId: string | null
  walletAddress: string | undefined
}

export function ChatInterface({ userId, walletAddress }: ChatInterfaceProps) {
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [savedMessages, setSavedMessages] = useState<any[]>([])
  const [supabaseError, setSupabaseError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "reconnecting">("connected")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingCommandRef = useRef<boolean>(false)
  const [supabase, setSupabase] = useState<any>(null)
  const { toast } = useToast()

  const { messages, input, handleInputChange, handleSubmit, setMessages, setInput, append } = useChat({
    api: "/api/chat",
    body: {
      userId,
      walletAddress,
    },
    onResponse: async (response) => {
      if (!response.ok) {
        setApiError(`API error: ${response.status} ${response.statusText}`)
        setConnectionStatus("disconnected")
        toast({
          title: "Error",
          description: `API error: ${response.status} ${response.statusText}`,
          variant: "destructive",
        })
      } else {
        setConnectionStatus("connected")
        const contentType = response.headers.get("Content-Type")
        if (contentType && contentType.includes("application/json")) {
          try {
            const data = await response.json()
            if (data.message) {
              append(data.message)
            }
          } catch (error) {
            console.error("Error parsing market info response:", error)
          }
        }
      }

      setLoading(false)
      pendingCommandRef.current = false

      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }
    },
    onError: (error) => {
      setApiError(`Error: ${error.message || "Unknown error"}`)
      setConnectionStatus("disconnected")
      toast({
        title: "Chat Error",
        description: error.message || "An error occurred while processing your request",
        variant: "destructive",
      })

      setLoading(false)
      pendingCommandRef.current = false

      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }
    },
  })

  useEffect(() => {
    async function initSupabase() {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

        if (!supabaseUrl || !supabaseKey) {
          setSupabaseError("Supabase URL or key is missing")
          return
        }

        const { createClient } = await import("@/lib/supabase/client")
        const client = createClient()
        setSupabase(client)
      } catch (error) {
        setSupabaseError(`Error initializing Supabase: ${error.message}`)
      }
    }

    initSupabase()
  }, [])

  useEffect(() => {
    async function loadChatHistory() {
      if (!userId || !supabase) return

      try {
        const { data, error } = await supabase
          .from("chat_history")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })

        if (error) {
          setSupabaseError(`Error loading chat history: ${error.message}`)
          return
        }

        if (data && data.length > 0) {
          const formattedMessages = data.map((msg: any) => ({
            id: msg.id,
            content: msg.message,
            role: msg.is_bot ? "assistant" : "user",
          }))
          setSavedMessages(formattedMessages)

          if (showHistory) {
            setMessages(formattedMessages.slice(-3))
          } else {
            setMessages([])
          }
        }
      } catch (error) {
        setSupabaseError(`Error loading chat history: ${error.message}`)
      }
    }

    if (supabase) {
      loadChatHistory()
    }
  }, [userId, supabase, setMessages, showHistory])

  const toggleHistory = () => {
    setShowHistory(!showHistory)
    if (!showHistory && savedMessages.length > 0) {
      const recentMessages = savedMessages.slice(-3)
      setMessages(recentMessages)
    } else {
      setMessages([])
    }
  }

  useEffect(() => {
    async function saveMessage(message: any) {
      if (!userId || !supabase) return

      try {
        const { error } = await supabase.from("chat_history").insert([
          {
            user_id: userId,
            message: message.content,
            is_bot: message.role === "assistant",
          },
        ])

        if (error) {
          setSupabaseError(`Error saving message: ${error.message}`)
        }

        setSavedMessages((prev) => [...prev, message])
      } catch (error) {
        setSupabaseError(`Error saving message: ${error.message}`)
      }
    }

    if (messages.length > 0 && supabase) {
      const lastMessage = messages[messages.length - 1]
      saveMessage(lastMessage)
    }
  }, [messages, userId, supabase])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const LoadingMessage = () => {
    const [dots, setDots] = useState("")

    useEffect(() => {
      const interval = setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? "" : prev + "."))
      }, 400)

      return () => clearInterval(interval)
    }, [])

    return (
      <div className="flex items-center gap-4 rounded-lg p-4 mr-auto max-w-[80%] bg-muted">
        <Avatar className="h-8 w-8">
          <AvatarFallback>
            <Bot className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
        <div className="text-sm">
          <p>{dots}</p>
        </div>
      </div>
    )
  }

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (input.trim() === "") return

    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current)
      loadingTimeoutRef.current = null
    }

    setApiError(null)
    setLoading(true)
    pendingCommandRef.current = true

    const currentInput = input.trim()
    setInput("")

    try {
      const response = await fetchWithRetry(
        "/api/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [...messages, { role: "user", content: currentInput }],
            userId,
            walletAddress,
          }),
        },
        3,
        500,
      )

      if (!response.ok) {
        return handleApiError(response)
      }

      const contentType = response.headers.get("Content-Type")
      if (contentType && contentType.includes("application/json")) {
        const data = await response.json()
        if (data.message) {
          append(data.message)
        } else if (data.error) {
          throw new Error(data.error)
        }
      }

      setLoading(false)
      pendingCommandRef.current = false

      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }
    } catch (error) {
      setLoading(false)
      pendingCommandRef.current = false
      setApiError(`Error: ${error.message || "Unknown error"}`)
      toast({
        title: "Error",
        description: error.message || "An error occurred while processing your request",
        variant: "destructive",
      })
    }
  }

  const handleCommandClick = (command: string) => {
    setInput(command)
    inputRef.current?.focus()
  }

  const processMarkdownLinks = (text: string) => {
    const linkRegex = /\[([^\]]+)\]$$([^)]+)$$/g
    const parts = []
    let lastIndex = 0
    let match

    while ((match = linkRegex.exec(text)) !== null) {
      const [fullMatch, linkText, url] = match
      const startIndex = match.index
      const endIndex = startIndex + fullMatch.length

      if (startIndex > lastIndex) {
        parts.push(text.substring(lastIndex, startIndex))
      }

      parts.push(
        <a
          key={`link-${startIndex}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          {linkText}
        </a>,
      )

      lastIndex = endIndex
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }

    return parts.length > 0 ? parts : text
  }

  const renderMessageContent = (content: string) => {
    const commandRegex = /\/(?:buy|sell|portfolio|analyze|market|recommend)\s+([A-Za-z]+)?\s*([0-9.]+)?\s*([A-Za-z]+)?/g
    const commandLinkRegex = /\[([^\]]+)\]$$command:([^)]+)$$/g
    const lines = content.split("\n")

    return lines.map((line, lineIndex) => {
      let match
      const processedLine = line
      const parts = []
      let lastIndex = 0

      let commandLinkMatch
      const commandLinkParts = []
      let lastCommandLinkIndex = 0

      commandLinkRegex.lastIndex = 0

      while ((commandLinkMatch = commandLinkRegex.exec(line)) !== null) {
        const [fullMatch, linkText, command] = commandLinkMatch
        const startIndex = commandLinkMatch.index
        const endIndex = startIndex + fullMatch.length

        if (startIndex > lastCommandLinkIndex) {
          commandLinkParts.push(processedLine.substring(lastCommandLinkIndex, startIndex))
        }

        commandLinkParts.push(
          <Button
            key={`cmdlink-${startIndex}`}
            variant="link"
            className="px-1 py-0 h-auto text-primary underline"
            onClick={() => handleCommandClick(command)}
          >
            {linkText}
          </Button>,
        )

        lastCommandLinkIndex = endIndex
      }

      if (lastCommandLinkIndex < processedLine.length) {
        commandLinkParts.push(processedLine.substring(lastCommandLinkIndex))
      }

      if (commandLinkParts.length > 0) {
        return (
          <p key={lineIndex} className={lineIndex > 0 ? "mt-2" : ""}>
            {commandLinkParts}
          </p>
        )
      }

      if (!commandLinkParts.length && line.includes("](")) {
        const processedLinks = processMarkdownLinks(line)
        if (Array.isArray(processedLinks)) {
          return (
            <p key={lineIndex} className={lineIndex > 0 ? "mt-2" : ""}>
              {processedLinks}
            </p>
          )
        }
      }

      commandRegex.lastIndex = 0

      while ((match = commandRegex.exec(line)) !== null) {
        const fullCommand = match[0]
        const startIndex = match.index
        const endIndex = startIndex + fullCommand.length

        if (startIndex > lastIndex) {
          parts.push(processedLine.substring(lastIndex, startIndex))
        }

        parts.push(
          <Button
            key={`cmd-${startIndex}`}
            variant="link"
            className="px-1 py-0 h-auto text-primary underline"
            onClick={() => handleCommandClick(fullCommand)}
          >
            {fullCommand}
          </Button>,
        )

        lastIndex = endIndex
      }

      if (lastIndex < processedLine.length) {
        parts.push(processedLine.substring(lastIndex))
      }

      if (parts.length === 0) {
        return (
          <p key={lineIndex} className={lineIndex > 0 ? "mt-2" : ""}>
            {line}
          </p>
        )
      }

      return (
        <p key={lineIndex} className={lineIndex > 0 ? "mt-2" : ""}>
          {parts}
        </p>
      )
    })
  }

  const commandShortcuts = [
    { command: "Show my portfolio", icon: <BarChart3 className="h-4 w-4" />, label: "Portfolio" },
    { command: "Analyze my portfolio", icon: <TrendingUp className="h-4 w-4" />, label: "Analyze" },
    { command: "Buy 0.01 ETH with USDC", icon: <DollarSign className="h-4 w-4" />, label: "Buy ETH" },
    { command: "Sell 0.001 WBTC for ETH", icon: <DollarSign className="h-4 w-4" />, label: "Sell WBTC" },
    { command: "What's the price of ETH?", icon: <Search className="h-4 w-4" />, label: "ETH Price" },
    { command: "What should I invest in?", icon: <Zap className="h-4 w-4" />, label: "Recommend" },
  ]

  useEffect(() => {
    if (loading) {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }

      loadingTimeoutRef.current = setTimeout(() => {
        if (loading) {
          setLoading(false)
          pendingCommandRef.current = false
          toast({
            title: "Request Timeout",
            description: "The request is taking longer than expected. Please try again.",
            variant: "destructive",
          })
        }
      }, 10000)

      return () => {
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current)
        }
      }
    }
  }, [loading, toast])

  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }

      setLoading(false)
      pendingCommandRef.current = false
    }
  }, [])

  return (
    <div className="flex flex-col h-[600px]">
      <div className="flex justify-between items-center mb-2 px-2">
        <div className="flex items-center space-x-2">
          <Switch id="history-toggle" checked={showHistory} onCheckedChange={toggleHistory} />
          <Label htmlFor="history-toggle" className="flex items-center">
            <History className="h-4 w-4 mr-1" />
            {showHistory ? "Hide Chat History" : "Show Chat History"}
          </Label>
        </div>
        {!showHistory && savedMessages.length > 0 && (
          <span className="text-xs text-muted-foreground">{savedMessages.length} previous messages hidden</span>
        )}
      </div>

      {supabaseError && (
        <Alert className="mb-2 bg-amber-50 border-amber-200 text-amber-800">
          <AlertTitle>Supabase Error</AlertTitle>
          <AlertDescription className="text-xs">{supabaseError}</AlertDescription>
        </Alert>
      )}

      {apiError && (
        <Alert className="mb-2 bg-red-50 border-red-200 text-red-800">
          <AlertTitle className="flex items-center">
            <AlertTriangle className="h-4 w-4 mr-2" />
            API Error
          </AlertTitle>
          <AlertDescription className="text-xs">{apiError}</AlertDescription>
        </Alert>
      )}

      <div className="bg-muted/40 rounded-lg p-2 mb-2 overflow-x-auto">
        <div className="flex space-x-2">
          <TooltipProvider>
            {commandShortcuts.map((shortcut, index) => (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 whitespace-nowrap"
                    onClick={() => handleCommandClick(shortcut.command)}
                  >
                    {shortcut.icon}
                    <span className="ml-1">{shortcut.label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{shortcut.command}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4 mb-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              <Bot className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <p>Hello! I'm your AI trading assistant.</p>
              <p className="text-sm mt-1">Ask me about your portfolio, get investment advice, or execute trades.</p>
              <div className="mt-4 text-xs text-muted-foreground/70">
                <p>Try these commands:</p>
                <div className="mt-2 space-y-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="mr-2"
                    onClick={() => handleCommandClick("Show my portfolio")}
                  >
                    <History className="h-4 w-4 mr-1" /> View Portfolio
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mr-2"
                    onClick={() => handleCommandClick("Buy 0.01 ETH with USDC")}
                  >
                    <DollarSign className="h-4 w-4 mr-1" /> Buy ETH
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleCommandClick("Sell 0.001 WBTC for ETH")}>
                    <DollarSign className="h-4 w-4 mr-1" /> Sell Token
                  </Button>
                </div>
                <p className="mt-3">Or use natural language:</p>
                <div className="mt-2 space-y-1 text-left">
                  <p className="text-muted-foreground/80">"Show my portfolio"</p>
                  <p className="text-muted-foreground/80">"Buy 0.1 ETH with USDC"</p>
                  <p className="text-muted-foreground/80">"Analyze my holdings"</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-center gap-4 rounded-lg p-4",
                    message.role === "user"
                      ? "ml-auto max-w-[80%] bg-primary text-primary-foreground"
                      : "mr-auto max-w-[80%] bg-muted",
                  )}
                >
                  {message.role === "assistant" && (
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>
                        <Bot className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className="text-sm">
                    {message.role === "assistant"
                      ? renderMessageContent(message.content)
                      : message.content.split("\n").map((text, i) => (
                          <p key={i} className={i > 0 ? "mt-2" : ""}>
                            {text}
                          </p>
                        ))}
                  </div>
                  {message.role === "user" && (
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        <User className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ))}
              {loading && <LoadingMessage />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      <Card className="border-t rounded-t-none rounded-b-lg">
        <form onSubmit={handleFormSubmit} className="flex items-center p-4">
          <Input
            ref={inputRef}
            placeholder="Ask a question or type a command..."
            value={input}
            onChange={handleInputChange}
            className="flex-1 mr-2"
            disabled={loading}
          />
          <Button type="submit" size="icon" disabled={loading}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </Card>
    </div>
  )
}
