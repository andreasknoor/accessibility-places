"use client"

import { useState, useEffect } from "react"
import { ChevronDown } from "lucide-react"
import type { ReactNode } from "react"

export interface FaqItem {
  id: string
  q: string
  a: ReactNode
  schemaText?: string
}

export interface FaqCategory {
  id: string
  icon: string
  label: string
  items: FaqItem[]
}

export function FaqAccordion({ categories }: { categories: FaqCategory[] }) {
  const [openId, setOpenId] = useState<string | null>(null)

  // Auto-open when arriving via deep-link (e.g. /faq#coloured-circle)
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash) setOpenId(hash)
  }, [])

  return (
    <>
      <nav className="flex flex-wrap gap-2 mb-8" aria-label="FAQ-Kategorien">
        {categories.map((cat) => (
          <a
            key={cat.id}
            href={`#${cat.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <span aria-hidden="true">{cat.icon}</span>
            <span>{cat.label}</span>
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-10">
        {categories.map((cat) => (
          <section key={cat.id} id={cat.id} className="scroll-mt-4">
            <h2 className="flex items-center gap-2 mb-0.5 pb-2.5 border-b border-border">
              <span aria-hidden="true">{cat.icon}</span>
              <span className="text-base font-semibold text-foreground">
                {cat.label}
              </span>
            </h2>

            <dl>
              {cat.items.map((item) => {
                const isOpen = openId === item.id
                return (
                  <div
                    key={item.id}
                    id={item.id}
                    className="scroll-mt-20 border-b border-border last:border-0"
                  >
                    <dt>
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen ? null : item.id)}
                        aria-expanded={isOpen}
                        aria-controls={`answer-${item.id}`}
                        className="w-full flex items-center justify-between gap-3 py-3.5 text-left text-sm font-medium text-foreground hover:text-primary transition-colors"
                      >
                        <span>{item.q}</span>
                        <ChevronDown
                          className="w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200"
                          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                        />
                      </button>
                    </dt>
                    <dd
                      id={`answer-${item.id}`}
                      style={{
                        display: "grid",
                        gridTemplateRows: isOpen ? "1fr" : "0fr",
                        transition: "grid-template-rows 220ms ease",
                      }}
                    >
                      <div className="overflow-hidden">
                        <div className="text-sm text-muted-foreground leading-relaxed pb-4 pt-0.5">
                          {item.a}
                        </div>
                      </div>
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        ))}
      </div>
    </>
  )
}
