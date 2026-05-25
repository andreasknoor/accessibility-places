"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { Settings, X } from "lucide-react"
import { useTranslations, useLocale } from "@/lib/i18n"
import { SETTING_CHIPS, DEFAULT_APP_SETTINGS } from "@/lib/settings"
import type { AppSettings } from "@/lib/settings"

interface Props {
  settings:           AppSettings
  onUpdate:           (patch: Partial<AppSettings>) => void
  onResetOnboarding?: () => void
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        value ? "bg-primary" : "bg-muted-foreground/40"
      }`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
        value ? "translate-x-4" : "translate-x-0.5"
      }`} />
    </button>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide pt-4 pb-1">
      {children}
    </p>
  )
}

function SelectInput({ value, onChange, children }: {
  value: string | number
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-border rounded-md px-2 py-1 bg-background max-w-[160px]"
    >
      {children}
    </select>
  )
}

function SliderInput({ value, min, max, step, onChange, displayLabel }: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  displayLabel: string
}) {
  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1.5 accent-primary cursor-pointer"
      />
      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right shrink-0">{displayLabel}</span>
    </div>
  )
}

function SettingsPanel({ settings, onUpdate, onResetOnboarding, onClose }: Props & { onClose: () => void }) {
  const t  = useTranslations()
  const ts = t.settings
  const { locale } = useLocale()

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="fixed inset-0 z-[1050] bg-black/25" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[1051] h-full w-[380px] max-w-full bg-white shadow-2xl border-l border-border flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <p className="font-semibold text-sm">{ts.title}</p>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">

          {/* ── Allgemein ── */}
          <SectionTitle>{ts.sectionGeneral}</SectionTitle>
          <div className="divide-y divide-border/60">
            <Row label={ts.searchMode}>
              <SelectInput
                value={settings.defaultSearchMode ?? ""}
                onChange={(v) => onUpdate({ defaultSearchMode: v === "" ? null : v as "text" | "nearby" | "place" })}
              >
                <option value="">{ts.searchModeDefault}</option>
                <option value="nearby">{ts.searchModeNearby}</option>
                <option value="text">{ts.searchModeText}</option>
                <option value="place">{ts.searchModePlace}</option>
              </SelectInput>
            </Row>
            <Row label={ts.defaultCategory}>
              <SelectInput
                value={settings.defaultChipIdx ?? -1}
                onChange={(v) => {
                  const n = parseInt(v)
                  onUpdate({ defaultChipIdx: n === -1 ? null : n })
                }}
              >
                <option value={-1}>{ts.categoryNone}</option>
                {SETTING_CHIPS.map((chip, i) => (
                  <option key={i} value={i}>
                    {chip.icon} {locale === "en" ? chip.en : chip.de}
                  </option>
                ))}
              </SelectInput>
            </Row>
          </div>

          {/* ── Karte ── */}
          <SectionTitle>{ts.sectionMap}</SectionTitle>
          <div className="divide-y divide-border/60">
            <Row label={ts.autoZoom} hint={ts.autoZoomHint}>
              <Toggle
                value={settings.autoZoom}
                onChange={(v) => onUpdate({ autoZoom: v })}
              />
            </Row>
            <Row label={ts.alwaysShowParking}>
              <Toggle
                value={settings.alwaysShowParking}
                onChange={(v) => onUpdate({ alwaysShowParking: v })}
              />
            </Row>
            <Row label={ts.parkingRadius}>
              <SliderInput
                min={0.05}
                max={3.0}
                step={0.05}
                value={settings.parkingRadiusKm}
                onChange={(v) => onUpdate({ parkingRadiusKm: v })}
                displayLabel={
                  settings.parkingRadiusKm < 1
                    ? `${Math.round(settings.parkingRadiusKm * 1000)} m`
                    : `${settings.parkingRadiusKm.toFixed(1)} km`
                }
              />
            </Row>
          </div>

          {/* ── Ergebnisse ── */}
          <SectionTitle>{ts.sectionResults}</SectionTitle>
          <div className="divide-y divide-border/60">
            <Row label={ts.sortOrder}>
              <SelectInput
                value={settings.sortOrder}
                onChange={(v) => onUpdate({ sortOrder: v as "confidence" | "distance" })}
              >
                <option value="confidence">{ts.sortConfidence}</option>
                <option value="distance">{ts.sortDistance}</option>
              </SelectInput>
            </Row>
          </div>

          {/* ── Mobil ── */}
          <SectionTitle>{ts.sectionMobile}</SectionTitle>
          <div className="divide-y divide-border/60">
            <Row label={ts.mobileView}>
              <SelectInput
                value={settings.defaultMobileView}
                onChange={(v) => onUpdate({ defaultMobileView: v as "results" | "map" })}
              >
                <option value="results">{ts.mobileViewList}</option>
                <option value="map">{ts.mobileViewMap}</option>
              </SelectInput>
            </Row>
          </div>

          {/* ── Reset ── */}
          <div className="border-t border-border mt-6 pt-4 flex justify-end">
            <button
              type="button"
              onClick={() => { onUpdate(DEFAULT_APP_SETTINGS); onResetOnboarding?.() }}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              {ts.resetToDefaults}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}

export default function SettingsSheet({ settings, onUpdate, onResetOnboarding }: Props) {
  const [open, setOpen] = useState(false)
  const t = useTranslations()

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t.settings.title}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={t.settings.title}
      >
        <Settings className="w-4 h-4" />
      </button>
      {open && createPortal(
        <SettingsPanel settings={settings} onUpdate={onUpdate} onResetOnboarding={onResetOnboarding} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}
