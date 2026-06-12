"use client"

import { useState, useEffect, useLayoutEffect } from "react"
import { ChevronDown, Link2, Check } from "lucide-react"
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
  const [openId,   setOpenId]   = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // useLayoutEffect runs synchronously before the browser paints, so the item
  // is already open when Next.js scrolls to the hash element — avoids the
  // race where the browser scrolls to a still-collapsed accordion.
  useLayoutEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash) setOpenId(hash)
  }, [])

  // Handle hash changes that happen while the component is already mounted:
  // - hashchange: clicking an <a href="#id"> link on the same page
  // - popstate:   browser back/forward restoring a hash from history
  useEffect(() => {
    function syncHash() {
      const hash = window.location.hash.slice(1)
      if (hash) setOpenId(hash)
    }
    window.addEventListener("hashchange", syncHash)
    window.addEventListener("popstate",   syncHash)
    return () => {
      window.removeEventListener("hashchange", syncHash)
      window.removeEventListener("popstate",   syncHash)
    }
  }, [])

  function toggleItem(id: string) {
    const next = openId === id ? null : id
    setOpenId(next)
    if (next) {
      history.replaceState(null, "", `#${id}`)
    } else {
      history.replaceState(null, "", window.location.pathname + window.location.search)
    }
  }

  function copyLink(id: string) {
    const url = `${window.location.origin}${window.location.pathname}#${id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    }).catch(() => { /* clipboard access denied — silently ignore */ })
  }

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
                const isOpen   = openId   === item.id
                const isCopied = copiedId === item.id
                return (
                  <div
                    key={item.id}
                    id={item.id}
                    className={`scroll-mt-20 border-b border-border last:border-0 border-l-2 transition-all duration-200 ${isOpen ? "border-l-primary pl-3" : "border-l-transparent"}`}
                  >
                    <dt className="flex items-center group">
                      <button
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        aria-expanded={isOpen}
                        aria-controls={`answer-${item.id}`}
                        className="flex-1 flex items-center justify-between gap-3 py-3.5 text-left text-sm font-medium text-foreground hover:text-primary transition-colors"
                      >
                        <span>{item.q}</span>
                        <ChevronDown
                          className="w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200"
                          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => copyLink(item.id)}
                        aria-label={isCopied ? "Link kopiert" : "Link zu dieser Frage kopieren"}
                        className="shrink-0 ml-2 p-1 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                      >
                        {isCopied
                          ? <Check  className="w-3.5 h-3.5 text-green-600" />
                          : <Link2  className="w-3.5 h-3.5" />
                        }
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
