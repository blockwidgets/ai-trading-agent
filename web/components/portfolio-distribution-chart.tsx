"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface PortfolioDistributionChartProps {
  data: any[]
}

// Predefined color palette with good contrast
const COLORS = [
  "#3b82f6", // blue-500
  "#ef4444", // red-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#6366f1", // indigo-500
  "#84cc16", // lime-500
  "#14b8a6", // teal-500
  "#a855f7", // purple-500
  "#64748b", // slate-500
]

export function PortfolioDistributionChart({ data }: PortfolioDistributionChartProps) {
  const [chartView, setChartView] = useState<"tokens" | "chains">("tokens")

  // Ensure data is valid
  const validData = Array.isArray(data) ? data : []

  // Filter out tokens with zero or undefined balanceUsd
  const filteredData = validData.filter((token) => token.balanceUsd && token.balanceUsd > 0)

  // Calculate total portfolio value
  const totalValue = filteredData.reduce((sum, token) => sum + token.balanceUsd, 0)

  // Prepare data for token distribution chart
  const tokenChartData = [...filteredData]
    .sort((a, b) => b.balanceUsd - a.balanceUsd)
    .slice(0, 5) // Take top 5 tokens
    .map((token, index) => ({
      name: token.symbol,
      value: token.balanceUsd,
      percentage: ((token.balanceUsd / totalValue) * 100).toFixed(1),
      chainName: token.chainName,
      color: COLORS[index % COLORS.length],
    }))

  // Add "Others" category if there are more than 5 tokens
  if (filteredData.length > 5) {
    const othersValue = filteredData.slice(5).reduce((sum, token) => sum + token.balanceUsd, 0)

    tokenChartData.push({
      name: "Others",
      value: othersValue,
      percentage: ((othersValue / totalValue) * 100).toFixed(1),
      chainName: "Multiple",
      color: COLORS[5 % COLORS.length],
    })
  }

  // Prepare data for chain distribution chart
  const chainMap: Record<string, number> = {}
  filteredData.forEach((token) => {
    const chainName = token.chainName || `Chain ${token.chainId}`
    chainMap[chainName] = (chainMap[chainName] || 0) + token.balanceUsd
  })

  const chainChartData = Object.entries(chainMap)
    .map(([name, value], index) => ({
      name,
      value,
      percentage: ((value / totalValue) * 100).toFixed(1),
      color: COLORS[index % COLORS.length],
    }))
    .sort((a, b) => b.value - a.value)

  // Get current chart data based on view
  const currentChartData = chartView === "tokens" ? tokenChartData : chainChartData

  // If no data or all values are 0, show a message
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">Portfolio Distribution</h3>
        <div className="flex items-center justify-center h-[300px]">
          <p className="text-gray-500">No portfolio data available</p>
        </div>
      </div>
    )
  }

  if (currentChartData.length === 0 || currentChartData.every((item) => item.value === 0)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Distribution</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">No portfolio data available</p>
        </CardContent>
      </Card>
    )
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-background border border-border p-2 rounded-md shadow-md">
          <p className="font-bold">{data.name}</p>
          <p className="text-sm">${data.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="text-sm">{data.percentage}% of portfolio</p>
          {data.chainName && <p className="text-xs text-muted-foreground">Chain: {data.chainName}</p>}
        </div>
      )
    }
    return null
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <CardTitle>Portfolio Distribution</CardTitle>
          <Tabs value={chartView} onValueChange={(v) => setChartView(v as "tokens" | "chains")}>
            <TabsList className="h-8">
              <TabsTrigger value="tokens" className="text-xs px-3">
                By Token
              </TabsTrigger>
              <TabsTrigger value="chains" className="text-xs px-3">
                By Chain
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={currentChartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={80}
                innerRadius={40}
                fill="#8884d8"
                dataKey="value"
                nameKey="name"
              >
                {currentChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value, entry, index) => (
                  <span style={{ color: currentChartData[index]?.color }}>
                    {value} ({currentChartData[index]?.percentage}%)
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
