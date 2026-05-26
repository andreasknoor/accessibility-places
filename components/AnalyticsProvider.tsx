"use client"

import { Analytics } from "@vercel/analytics/next"

export default function AnalyticsProvider() {
  return (
    <Analytics
      beforeSend={(event) => {
        if (new URLSearchParams(window.location.search).has("notrack")) return null
        return event
      }}
    />
  )
}
