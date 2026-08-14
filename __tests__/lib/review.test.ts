import { describe, it, expect, vi, beforeEach } from "vitest"

const mockIsNativePlatform = vi.fn()
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mockIsNativePlatform() } }))

const mockPrefsGet = vi.fn()
const mockPrefsSet = vi.fn()
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: (o: unknown) => mockPrefsGet(o), set: (o: unknown) => mockPrefsSet(o) },
}))

const mockRequestReview = vi.fn()
vi.mock("@capacitor-community/in-app-review", () => ({
  InAppReview: { requestReview: () => mockRequestReview() },
}))

vi.mock("@/lib/config", () => ({ APP_VERSION: "9.9" }))

import { maybeRequestReview } from "@/lib/native/review"

describe("maybeRequestReview", () => {
  beforeEach(() => {
    mockIsNativePlatform.mockReset()
    mockPrefsGet.mockReset()
    mockPrefsSet.mockReset()
    mockRequestReview.mockReset()
  })

  it("is a no-op on web (not native)", async () => {
    mockIsNativePlatform.mockReturnValue(false)
    await maybeRequestReview()
    expect(mockPrefsGet).not.toHaveBeenCalled()
    expect(mockRequestReview).not.toHaveBeenCalled()
  })

  it("requests a review and persists the current version on first ask", async () => {
    mockIsNativePlatform.mockReturnValue(true)
    mockPrefsGet.mockResolvedValue({ value: null })
    await maybeRequestReview()
    expect(mockPrefsSet).toHaveBeenCalledWith({ key: "ap_review_prompt_version", value: "9.9" })
    expect(mockRequestReview).toHaveBeenCalledTimes(1)
  })

  it("does not ask again for the same APP_VERSION", async () => {
    mockIsNativePlatform.mockReturnValue(true)
    mockPrefsGet.mockResolvedValue({ value: "9.9" })
    await maybeRequestReview()
    expect(mockPrefsSet).not.toHaveBeenCalled()
    expect(mockRequestReview).not.toHaveBeenCalled()
  })

  it("asks again once the app has been updated to a new version", async () => {
    mockIsNativePlatform.mockReturnValue(true)
    mockPrefsGet.mockResolvedValue({ value: "9.8" })
    await maybeRequestReview()
    expect(mockRequestReview).toHaveBeenCalledTimes(1)
  })

  it("swallows errors from an unavailable plugin rather than throwing", async () => {
    mockIsNativePlatform.mockReturnValue(true)
    mockPrefsGet.mockRejectedValue(new Error("plugin unavailable"))
    await expect(maybeRequestReview()).resolves.toBeUndefined()
  })
})
