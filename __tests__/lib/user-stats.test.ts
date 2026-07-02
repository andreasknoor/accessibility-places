// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// Fake Upstash client: pipeline chain + the read/prune commands used by user-stats.
const execMock   = vi.fn().mockResolvedValue([])
const pipeline   = {
  zincrby: vi.fn(),
  hsetnx:  vi.fn(),
  hset:    vi.fn(),
  expire:  vi.fn(),
  exec:    execMock,
}
pipeline.zincrby.mockReturnValue(pipeline)
pipeline.hsetnx.mockReturnValue(pipeline)
pipeline.hset.mockReturnValue(pipeline)
pipeline.expire.mockReturnValue(pipeline)

const redisMock = {
  pipeline: vi.fn(() => pipeline),
  zrange:   vi.fn(),
  hgetall:  vi.fn(),
  zrem:     vi.fn().mockResolvedValue(1),
  scan:     vi.fn(),
  del:      vi.fn().mockResolvedValue(1),
  exists:   vi.fn().mockResolvedValue(1),
  hset:     vi.fn().mockResolvedValue(1),
  hdel:     vi.fn().mockResolvedValue(1),
  ttl:      vi.fn().mockResolvedValue(1000),
  expire:   vi.fn().mockResolvedValue(1),
}

vi.mock("@/lib/stats", () => ({ getRedis: () => redisMock }))

import { trackUserSearch, getTopUsers, resetUserStats, setUserComment, COMMENT_MAX_LENGTH } from "@/lib/user-stats"

const UID = "01234567-89ab-4cde-8f01-23456789abcd"

async function flush() {
  // trackUserSearch is fire-and-forget — let the microtask queue drain.
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  pipeline.zincrby.mockReturnValue(pipeline)
  pipeline.hsetnx.mockReturnValue(pipeline)
  pipeline.hset.mockReturnValue(pipeline)
  pipeline.expire.mockReturnValue(pipeline)
  execMock.mockResolvedValue([])
  redisMock.exists.mockResolvedValue(1)
  redisMock.hset.mockResolvedValue(1)
  redisMock.hdel.mockResolvedValue(1)
  redisMock.ttl.mockResolvedValue(1000)
  redisMock.expire.mockResolvedValue(1)
})

describe("trackUserSearch validation", () => {
  it("tracks a valid uid + platform", async () => {
    trackUserSearch(UID, "web")
    await flush()
    expect(pipeline.zincrby).toHaveBeenCalledWith("users:by_searches", 1, UID)
    expect(pipeline.hsetnx).toHaveBeenCalledWith(`user:${UID}`, "firstSeen", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(pipeline.hset).toHaveBeenCalledWith(`user:${UID}`, expect.objectContaining({ platform: "web" }))
    expect(pipeline.expire).toHaveBeenCalledWith(`user:${UID}`, 180 * 24 * 60 * 60)
  })

  it.each([
    ["non-uuid string", "not-a-uuid", "web"],
    ["uppercase uuid rejected (client emits lowercase)", UID.toUpperCase(), "web"],
    ["script injection", "<script>alert(1)</script>", "web"],
    ["missing uid", undefined, "web"],
    ["non-string uid", 42, "web"],
    ["unknown platform", UID, "windows"],
    ["non-string platform", UID, null],
  ])("drops %s", async (_label, uid, platform) => {
    trackUserSearch(uid, platform)
    await flush()
    expect(redisMock.pipeline).not.toHaveBeenCalled()
  })
})

describe("getTopUsers", () => {
  it("returns users with hash data, ordered by the zset", async () => {
    redisMock.zrange.mockResolvedValue([UID, 42])
    redisMock.hgetall.mockResolvedValue({ firstSeen: "2026-06-01", lastSeen: "2026-07-02", platform: "ios" })

    const users = await getTopUsers(20)
    expect(redisMock.zrange).toHaveBeenCalledWith("users:by_searches", 0, 39, { rev: true, withScores: true })
    expect(users).toEqual([
      { uid: UID, searches: 42, firstSeen: "2026-06-01", lastSeen: "2026-07-02", platform: "ios", comment: null },
    ])
  })

  it("prunes zset members whose hash has expired", async () => {
    const expiredUid = "99999999-9999-4999-8999-999999999999"
    redisMock.zrange.mockResolvedValue([expiredUid, 100, UID, 42])
    redisMock.hgetall
      .mockResolvedValueOnce(null)                                     // expired user
      .mockResolvedValueOnce({ firstSeen: "2026-06-01", lastSeen: "2026-07-02", platform: "web" })

    const users = await getTopUsers(20)
    expect(users).toHaveLength(1)
    expect(users[0].uid).toBe(UID)
    expect(redisMock.zrem).toHaveBeenCalledWith("users:by_searches", expiredUid)
  })

  it("returns [] when the zset is empty", async () => {
    redisMock.zrange.mockResolvedValue([])
    expect(await getTopUsers(20)).toEqual([])
  })
})

describe("setUserComment", () => {
  it("stores a trimmed comment on an existing user", async () => {
    expect(await setUserComment(UID, "  power user, Berlin area  ")).toBe(true)
    expect(redisMock.hset).toHaveBeenCalledWith(`user:${UID}`, { comment: "power user, Berlin area" })
  })

  it("caps the comment at COMMENT_MAX_LENGTH", async () => {
    await setUserComment(UID, "x".repeat(COMMENT_MAX_LENGTH + 50))
    const stored = redisMock.hset.mock.calls[0][1].comment as string
    expect(stored).toHaveLength(COMMENT_MAX_LENGTH)
  })

  it("clears the comment field when given an empty string", async () => {
    expect(await setUserComment(UID, "   ")).toBe(true)
    expect(redisMock.hdel).toHaveBeenCalledWith(`user:${UID}`, "comment")
    expect(redisMock.hset).not.toHaveBeenCalled()
  })

  it("refuses when the user hash no longer exists (no TTL-less resurrection)", async () => {
    redisMock.exists.mockResolvedValue(0)
    expect(await setUserComment(UID, "note")).toBe(false)
    expect(redisMock.hset).not.toHaveBeenCalled()
  })

  it("re-arms the TTL if the key lost it in the exists→hset race", async () => {
    redisMock.ttl.mockResolvedValue(-1)
    await setUserComment(UID, "note")
    expect(redisMock.expire).toHaveBeenCalledWith(`user:${UID}`, 180 * 24 * 60 * 60)
  })

  it("rejects invalid uids and non-string comments", async () => {
    expect(await setUserComment("not-a-uuid", "note")).toBe(false)
    expect(await setUserComment(UID, 42)).toBe(false)
    expect(redisMock.hset).not.toHaveBeenCalled()
  })
})

describe("resetUserStats", () => {
  it("deletes the ranking zset and every user hash", async () => {
    redisMock.scan.mockResolvedValue([0, [`user:${UID}`, "user:other"]])
    const deleted = await resetUserStats()
    expect(deleted).toBe(3) // zset + 2 hashes
    expect(redisMock.del).toHaveBeenCalledWith("users:by_searches", `user:${UID}`, "user:other")
  })

  it("deletes only the zset key when no user hashes exist", async () => {
    redisMock.scan.mockResolvedValue([0, []])
    const deleted = await resetUserStats()
    expect(deleted).toBe(1)
    expect(redisMock.del).toHaveBeenCalledWith("users:by_searches")
  })
})
