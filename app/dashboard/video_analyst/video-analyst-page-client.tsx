"use client"

import { useEffect, useMemo, useState } from "react"
import z from "zod"

import { cn } from "@/lib/utils"

type Gender = "men" | "women"
type Category = "under_14" | "under_16" | "under_19" | "under_23" | "ranji" | "senior"
type DashboardTab = "overview" | "tournaments" | "matches" | "access"

type Player = {
  id: string
  name: string
  username: string
  gender: Gender
  category: string
}

type UploadedVideo = {
  id: string
  player_id: string
  player_name: string
  player_username: string
  file_name: string
  file_type: string
  s3_key: string
  created_at: string
}

type PendingVideo = {
  id: string
  fileName: string
  sizeMb: string
}

type Match = {
  id: string
  name: string
  created_at: string
  players: Player[]
  uploaded_videos: UploadedVideo[]
}

type Tournament = {
  id: string
  name: string
  analyst_id: string
  gender: Gender
  category: string
  created_at: string
  matches: Match[]
}

type Analyst = {
  id: string
  username: string
  name: string
  gender: Gender
  category: Category
}

type AnalystDataResponse = {
  message: string
  success: boolean
  role: "video_analyst" | "player"
  analyst?: Analyst
  tournaments?: Tournament[]
  players_in_created_matches?: Player[]
  players_same_gender_category?: Player[]
  uploaded_videos?: UploadedVideo[]
}

const createTournamentSchema = z.discriminatedUnion("gender", [
  z.object({
    name: z.string().min(2, "Tournament name is required"),
    analystId: z.string().uuid("Invalid analyst id"),
    gender: z.literal("men"),
    category: z.enum(["under_14", "under_16", "under_19", "under_23", "ranji"]),
  }),
  z.object({
    name: z.string().min(2, "Tournament name is required"),
    analystId: z.string().uuid("Invalid analyst id"),
    gender: z.literal("women"),
    category: z.enum(["under_16", "under_19", "under_23", "senior"]),
  }),
])

const createMatchSchema = z.object({
  tournamentId: z.string().uuid("Invalid tournament id"),
  name: z.string().min(2, "Match name is required"),
})

const addPlayersSchema = z.object({
  matchId: z.string().uuid("Invalid match ID"),
  playerIds: z.array(z.string().uuid("Invalid player ID")).min(1, "At least one player required"),
})

const formatCategory = (cat: string) => cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-2 focus:ring-blue-500/20"

interface VideoAnalystPageClientProps {
  analystId: string
}

export default function VideoAnalystPageClient({ analystId }: VideoAnalystPageClientProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview")
  const [data, setData] = useState<AnalystDataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null)

  const [tournamentName, setTournamentName] = useState("")
  const [selectedTournamentId, setSelectedTournamentId] = useState("")
  const [selectedTournamentForMatchList, setSelectedTournamentForMatchList] = useState("all")
  const [matchName, setMatchName] = useState("")
  const [selectedMatchId, setSelectedMatchId] = useState("")
  const [selectedViewerIds, setSelectedViewerIds] = useState<string[]>([])
  const [viewerDraftByMatch, setViewerDraftByMatch] = useState<Record<string, string[]>>({})
  const [pendingVideosByMatch, setPendingVideosByMatch] = useState<Record<string, PendingVideo[]>>({})
  const [draggingVideoMatchId, setDraggingVideoMatchId] = useState<string | null>(null)

  const tournaments = data?.tournaments ?? []
  const playersSamePool = data?.players_same_gender_category ?? []

  const matchesWithTournament = useMemo(
    () =>
      tournaments.flatMap((tournament) =>
        (tournament.matches ?? []).map((match) => ({
          ...match,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
        })),
      ),
    [tournaments],
  )

  const totalVideos = useMemo(
    () => matchesWithTournament.reduce((sum, match) => sum + match.uploaded_videos.length, 0),
    [matchesWithTournament],
  )

  const totalPlayersInMatches = data?.players_in_created_matches?.length ?? 0

  const selectedMatch = useMemo(
    () => matchesWithTournament.find((match) => match.id === selectedMatchId) ?? null,
    [matchesWithTournament, selectedMatchId],
  )

  const filteredMatchesWithTournament = useMemo(() => {
    if (selectedTournamentForMatchList === "all") return matchesWithTournament
    return matchesWithTournament.filter((match) => match.tournamentId === selectedTournamentForMatchList)
  }, [matchesWithTournament, selectedTournamentForMatchList])

  const fetchAnalystData = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/${analystId}/getUser`, {
        method: "GET",
        cache: "no-store",
      })

      const payload = (await response.json()) as AnalystDataResponse

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Failed to fetch analyst data")
      }

      if (payload.role !== "video_analyst") {
        throw new Error("Current user is not a video analyst")
      }

      setData(payload)

      const nextTournaments = payload.tournaments ?? []
      const nextMatches = nextTournaments.flatMap((t) => t.matches ?? [])

      if (nextTournaments.length > 0) {
        setSelectedTournamentId((prev) =>
          nextTournaments.some((t) => t.id === prev) ? prev : nextTournaments[0].id,
        )
        setSelectedTournamentForMatchList((prev) =>
          prev === "all" || nextTournaments.some((t) => t.id === prev) ? prev : "all",
        )
      } else {
        setSelectedTournamentId("")
        setSelectedTournamentForMatchList("all")
      }

      if (nextMatches.length > 0) {
        const nextMatchId = nextMatches.some((m) => m.id === selectedMatchId)
          ? selectedMatchId
          : nextMatches[0].id

        setSelectedMatchId(nextMatchId)
        const matchPlayers = nextMatches.find((m) => m.id === nextMatchId)?.players ?? []
        setSelectedViewerIds(matchPlayers.map((p) => p.id))
      } else {
        setSelectedMatchId("")
        setSelectedViewerIds([])
      }

      const nextViewerDraft: Record<string, string[]> = {}
      for (const match of nextMatches) {
        nextViewerDraft[match.id] = (match.players ?? []).map((player) => player.id)
      }
      setViewerDraftByMatch(nextViewerDraft)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unable to load data")
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchAnalystData()
  }, [analystId])

  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault()
    setBanner(null)

    if (!data?.analyst) return

    const parsed = createTournamentSchema.safeParse({
      name: tournamentName.trim(),
      analystId: data.analyst.id,
      gender: data.analyst.gender,
      category: data.analyst.category,
    })

    if (!parsed.success) {
      setBanner({ ok: false, msg: parsed.error.issues[0]?.message ?? "Invalid tournament data" })
      return
    }

    setBusy(true)

    try {
      const response = await fetch("/api/video_analyst/create_tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })

      const result = await response.json()

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Could not create tournament")
      }

      setTournamentName("")
      await fetchAnalystData()
      setBanner({ ok: true, msg: "Tournament created successfully." })
    } catch (createError) {
      setBanner({
        ok: false,
        msg: createError instanceof Error ? createError.message : "Could not create tournament",
      })
    } finally {
      setBusy(false)
    }
  }

  const handleCreateMatch = async (e: React.FormEvent) => {
    e.preventDefault()
    setBanner(null)

    const parsed = createMatchSchema.safeParse({
      tournamentId: selectedTournamentId,
      name: matchName.trim(),
    })

    if (!parsed.success) {
      setBanner({ ok: false, msg: parsed.error.issues[0]?.message ?? "Invalid match data" })
      return
    }

    setBusy(true)

    try {
      const response = await fetch("/api/video_analyst/create_match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })

      const result = await response.json()

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Could not create match")
      }

      setMatchName("")
      await fetchAnalystData()
      setBanner({ ok: true, msg: "Match created successfully." })
    } catch (createError) {
      setBanner({
        ok: false,
        msg: createError instanceof Error ? createError.message : "Could not create match",
      })
    } finally {
      setBusy(false)
    }
  }

  const handleToggleViewer = (playerId: string) => {
    setSelectedViewerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId],
    )
  }

  const handleToggleViewerForMatch = (matchId: string, playerId: string) => {
    setViewerDraftByMatch((prev) => {
      const current = prev[matchId] ?? []
      const next = current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId]

      return {
        ...prev,
        [matchId]: next,
      }
    })
  }

  const queueVideosForMatch = (matchId: string, files: File[]) => {
    const onlyVideos = files.filter((file) => file.type.startsWith("video/"))

    if (onlyVideos.length === 0) {
      setBanner({ ok: false, msg: "Please select video files only." })
      return
    }

    const queued: PendingVideo[] = onlyVideos.map((file) => ({
      id: crypto.randomUUID(),
      fileName: file.name,
      sizeMb: (file.size / (1024 * 1024)).toFixed(1),
    }))

    setPendingVideosByMatch((prev) => ({
      ...prev,
      [matchId]: [...(prev[matchId] ?? []), ...queued],
    }))

    setBanner({ ok: true, msg: `${queued.length} video(s) queued for this match. (UI only)` })
  }

  const removeQueuedVideo = (matchId: string, pendingVideoId: string) => {
    setPendingVideosByMatch((prev) => ({
      ...prev,
      [matchId]: (prev[matchId] ?? []).filter((video) => video.id !== pendingVideoId),
    }))
  }

  const handleSavePlayers = async (e: React.FormEvent) => {
    e.preventDefault()
    setBanner(null)

    const parsed = addPlayersSchema.safeParse({
      matchId: selectedMatchId,
      playerIds: selectedViewerIds,
    })

    if (!parsed.success) {
      setBanner({ ok: false, msg: parsed.error.issues[0]?.message ?? "Invalid players payload" })
      return
    }

    setBusy(true)

    try {
      const response = await fetch("/api/video_analyst/add_players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result?.error || result?.message || "Could not add players")
      }

      await fetchAnalystData()
      setBanner({ ok: true, msg: "Players added to match successfully." })
    } catch (saveError) {
      setBanner({
        ok: false,
        msg: saveError instanceof Error ? saveError.message : "Could not add players",
      })
    } finally {
      setBusy(false)
    }
  }

  const handleSavePlayersForMatch = async (matchId: string) => {
    setBanner(null)

    const playerIds = viewerDraftByMatch[matchId] ?? []

    const parsed = addPlayersSchema.safeParse({
      matchId,
      playerIds,
    })

    if (!parsed.success) {
      setBanner({ ok: false, msg: parsed.error.issues[0]?.message ?? "Invalid players payload" })
      return
    }

    setBusy(true)

    try {
      const response = await fetch("/api/video_analyst/add_players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result?.error || result?.message || "Could not update players")
      }

      await fetchAnalystData()
      setBanner({ ok: true, msg: "Players access updated for this match." })
    } catch (saveError) {
      setBanner({
        ok: false,
        msg: saveError instanceof Error ? saveError.message : "Could not update players",
      })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="relative min-h-screen bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)]">
        <div className="mx-auto flex min-h-screen max-w-275 items-center justify-center px-6">
          <p className="text-sm text-slate-300">Loading video analyst dashboard...</p>
        </div>
      </div>
    )
  }

  if (error || !data?.analyst) {
    return (
      <div className="relative min-h-screen bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)]">
        <div className="mx-auto flex min-h-screen max-w-275 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-red-300">{error || "Unable to load analyst profile"}</p>
          <button
            type="button"
            onClick={() => void fetchAnalystData()}
            className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)] font-['DM_Sans','Segoe_UI',sans-serif] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(59,130,246,0.06)_0%,transparent_60%),radial-gradient(ellipse_at_80%_20%,rgba(96,165,250,0.04)_0%,transparent_50%)]" />
      <div className="pointer-events-none fixed inset-0 bg-size-[48px_48px] bg-[linear-gradient(rgba(59,130,246,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.04)_1px,transparent_1px)]" />

      <div className="relative mx-auto max-w-275 px-6 pb-20 pt-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-blue-500">Video Analyst</p>
            <h1 className="m-0 bg-[linear-gradient(135deg,#ffffff_0%,#94a3b8_100%)] bg-clip-text text-3xl font-bold tracking-[-0.02em] text-transparent md:text-[32px]">
              Tournament Workspace
            </h1>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/10 px-4 py-2 text-[13px] font-semibold text-blue-200">
            <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
            {formatCategory(data.analyst.gender)} {formatCategory(data.analyst.category)}
          </div>
        </header>

        <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "My Tournaments", value: tournaments.length, icon: "🏆" },
            { label: "My Matches", value: matchesWithTournament.length, icon: "📌" },
            { label: "Uploaded Videos", value: totalVideos, icon: "🎥" },
            { label: "Players in Matches", value: totalPlayersInMatches, icon: "🏏" },
          ].map((card) => (
            <div
              key={card.label}
              className="flex items-center gap-4 rounded-[14px] border border-white/10 bg-slate-950/70 px-6 py-5 backdrop-blur-xl"
            >
              <span className="text-[28px]">{card.icon}</span>
              <div>
                <p className="m-0 text-[28px] font-bold leading-none">{card.value}</p>
                <p className="mt-1 text-xs tracking-[0.03em] text-gray-500">{card.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-slate-950/60 p-2">
          {([
            ["overview", "📋 Overview"],
            ["tournaments", "🏆 Tournaments"],
            ["matches", "🎥 Matches"],
            ["access", "🔐 Player Access"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key)
                setBanner(null)
              }}
              className={cn(
                "rounded-[9px] px-4 py-2.5 text-sm font-semibold transition",
                activeTab === key
                  ? "bg-blue-500/15 text-blue-200 shadow-[0_0_0_1px_rgba(59,130,246,0.3)]"
                  : "text-gray-400 hover:text-gray-300",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {banner && (
          <div
            className={cn(
              "mb-5 rounded-lg border px-4 py-3 text-sm font-semibold",
              banner.ok
                ? "border-green-400/30 bg-green-500/10 text-green-300"
                : "border-red-400/30 bg-red-500/10 text-red-300",
            )}
          >
            {banner.ok ? "✓" : "✗"} {banner.msg}
          </div>
        )}

        {activeTab === "overview" && (
          <div className="rounded-[18px] border border-white/10 bg-slate-950/75 p-7 backdrop-blur-2xl">
            <p className="mb-5 text-base font-semibold text-slate-200">Tournaments Created By You</p>
            <div className="space-y-3">
              {tournaments.length === 0 ? (
                <p className="text-sm text-slate-400">No tournaments created yet.</p>
              ) : (
                tournaments.map((tournament) => (
                  <div key={tournament.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-sm font-semibold text-slate-100">{tournament.name}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatCategory(tournament.gender)} / {formatCategory(tournament.category)} • {tournament.matches.length} match(es)
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "tournaments" && (
          <div className="rounded-[18px] border border-white/10 bg-slate-950/75 p-7 backdrop-blur-2xl">
            <p className="mb-5 text-base font-semibold text-slate-200">Create Tournament</p>

            <form onSubmit={handleCreateTournament} className="space-y-4">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-gray-500">
                  Tournament Name
                </label>
                <input
                  className={inputClass}
                  value={tournamentName}
                  onChange={(e) => setTournamentName(e.target.value)}
                  placeholder="e.g. Inter District U16 Championship"
                  disabled={busy}
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-[linear-gradient(135deg,#60a5fa,#3b82f6)] px-8 py-3 text-sm font-bold text-white shadow-[0_4px_24px_rgba(59,130,246,0.3)] transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Saving..." : "Create Tournament"}
              </button>
            </form>

            <div className="mt-7 space-y-3">
              <p className="text-sm font-semibold text-slate-200">Created Tournaments</p>
              {tournaments.length === 0 ? (
                <p className="text-sm text-slate-400">No tournaments created yet.</p>
              ) : (
                tournaments.map((tournament) => (
                  <div key={tournament.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-sm font-semibold text-slate-100">{tournament.name}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatCategory(tournament.gender)} / {formatCategory(tournament.category)} • {tournament.matches.length} match(es)
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "matches" && (
          <div className="space-y-5">
            <div className="rounded-[18px] border border-white/10 bg-slate-950/75 p-7 backdrop-blur-2xl">
              <p className="mb-5 text-base font-semibold text-slate-200">Create Match</p>

              <form onSubmit={handleCreateMatch} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-gray-500">Tournament</label>
                  <select
                    className={inputClass}
                    value={selectedTournamentId}
                    onChange={(e) => setSelectedTournamentId(e.target.value)}
                    disabled={busy || tournaments.length === 0}
                  >
                    {tournaments.map((tournament) => (
                      <option key={tournament.id} value={tournament.id} className="bg-slate-900 text-slate-100">
                        {tournament.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-gray-500">Match Name</label>
                  <input
                    className={inputClass}
                    value={matchName}
                    onChange={(e) => setMatchName(e.target.value)}
                    placeholder="e.g. Quarter Final - Match 1"
                    disabled={busy}
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={busy || tournaments.length === 0}
                    className="w-full rounded-xl bg-[linear-gradient(135deg,#60a5fa,#3b82f6)] px-6 py-3 text-sm font-bold text-white shadow-[0_4px_24px_rgba(59,130,246,0.3)] transition disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? "Saving..." : "Create Match"}
                  </button>
                </div>
              </form>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="xl:col-span-2 rounded-[18px] border border-white/10 bg-slate-950/75 p-5 backdrop-blur-2xl">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-gray-500">
                      Show Matches For Tournament
                    </label>
                    <select
                      className={inputClass}
                      value={selectedTournamentForMatchList}
                      onChange={(e) => setSelectedTournamentForMatchList(e.target.value)}
                    >
                      <option value="all" className="bg-slate-900 text-slate-100">
                        All Tournaments
                      </option>
                      {tournaments.map((tournament) => (
                        <option key={tournament.id} value={tournament.id} className="bg-slate-900 text-slate-100">
                          {tournament.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {filteredMatchesWithTournament.map((match) => (
                <div key={match.id} className="rounded-[18px] border border-white/10 bg-slate-950/75 p-5 backdrop-blur-2xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{match.name}</p>
                      <p className="mt-1 text-xs text-blue-200">{match.tournamentName}</p>
                    </div>
                    <span className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-300">
                      {match.uploaded_videos.length} videos
                    </span>
                  </div>

                  <div
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDraggingVideoMatchId(match.id)
                    }}
                    onDragLeave={() => setDraggingVideoMatchId((prev) => (prev === match.id ? null : prev))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDraggingVideoMatchId(null)
                      queueVideosForMatch(match.id, Array.from(e.dataTransfer.files))
                    }}
                    className={cn(
                      "mt-4 rounded-xl border border-dashed p-4 text-center transition",
                      draggingVideoMatchId === match.id
                        ? "border-blue-400/60 bg-blue-500/10"
                        : "border-white/20 bg-black/20",
                    )}
                  >
                    <p className="text-sm font-semibold text-slate-100">Add Multiple Videos To This Match</p>
                    <p className="mt-1 text-xs text-slate-400">Drag and drop files here or choose multiple videos.</p>
                    <input
                      type="file"
                      accept="video/*"
                      multiple
                      className="mt-3 w-full cursor-pointer text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-blue-500/20 file:px-3 file:py-1.5 file:text-blue-200"
                      onChange={(e) => {
                        const files = e.target.files ? Array.from(e.target.files) : []
                        queueVideosForMatch(match.id, files)
                        e.currentTarget.value = ""
                      }}
                    />
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Queued Videos (UI only)</p>
                    {(pendingVideosByMatch[match.id] ?? []).length === 0 ? (
                      <p className="text-xs text-slate-500">No videos queued yet.</p>
                    ) : (
                      <div className="max-h-32 space-y-2 overflow-auto pr-1">
                        {(pendingVideosByMatch[match.id] ?? []).map((video) => (
                          <div key={video.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                            <div>
                              <p className="font-medium text-slate-200">{video.fileName}</p>
                              <p className="mt-1 text-slate-400">{video.sizeMb} MB</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeQueuedVideo(match.id, video.id)}
                              className="rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 max-h-44 space-y-2 overflow-auto pr-1">
                    {match.uploaded_videos.length === 0 ? (
                      <p className="text-xs text-slate-500">No uploaded videos yet.</p>
                    ) : (
                      match.uploaded_videos.map((video) => (
                        <div key={video.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                          <p className="font-medium text-slate-200">{video.file_name}</p>
                          <p className="mt-1 text-slate-400">
                            {video.player_name} • {formatDate(video.created_at)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                        Change Players Access
                      </p>
                      <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
                        {(viewerDraftByMatch[match.id] ?? match.players.map((player) => player.id)).length} selected
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {playersSamePool.map((player) => {
                        const selected = (viewerDraftByMatch[match.id] ?? match.players.map((p) => p.id)).includes(player.id)

                        return (
                          <button
                            type="button"
                            key={player.id}
                            onClick={() => handleToggleViewerForMatch(match.id, player.id)}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-left text-xs transition",
                              selected
                                ? "border-blue-400/40 bg-blue-500/10 text-blue-200"
                                : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20",
                            )}
                          >
                            <div className="font-semibold">{player.name}</div>
                            <div className="mt-1 text-[11px] text-slate-400">@{player.username}</div>
                          </button>
                        )
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleSavePlayersForMatch(match.id)}
                      disabled={busy}
                      className="mt-3 rounded-lg bg-blue-500/20 px-4 py-2 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? "Saving..." : "Save Players For This Match"}
                    </button>
                  </div>
                </div>
              ))}

              {filteredMatchesWithTournament.length === 0 && (
                <div className="xl:col-span-2 rounded-[18px] border border-white/10 bg-slate-950/75 p-8 text-center backdrop-blur-2xl">
                  <p className="text-sm text-slate-400">No matches found for the selected tournament.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "access" && (
          <div className="rounded-[18px] border border-white/10 bg-slate-950/75 p-7 backdrop-blur-2xl">
            <p className="mb-5 text-base font-semibold text-slate-200">Add Players To Matches</p>

            <form onSubmit={handleSavePlayers} className="space-y-5">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-gray-500">Match</label>
                <select
                  className={inputClass}
                  value={selectedMatchId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    setSelectedMatchId(nextId)
                    const nextMatch = matchesWithTournament.find((match) => match.id === nextId)
                    setSelectedViewerIds((nextMatch?.players ?? []).map((player) => player.id))
                  }}
                  disabled={busy || matchesWithTournament.length === 0}
                >
                  {matchesWithTournament.map((match) => (
                    <option key={match.id} value={match.id} className="bg-slate-900 text-slate-100">
                      {match.name} • {match.tournamentName}
                    </option>
                  ))}
                </select>
              </div>

              {selectedMatch && (
                <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                  This match currently has {selectedMatch.players.length} player(s) and {selectedMatch.uploaded_videos.length} uploaded video(s).
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {playersSamePool.map((player) => {
                  const selected = selectedViewerIds.includes(player.id)
                  return (
                    <button
                      type="button"
                      key={player.id}
                      onClick={() => handleToggleViewer(player.id)}
                      className={cn(
                        "rounded-xl border p-3 text-left transition",
                        selected
                          ? "border-blue-400/40 bg-blue-500/10"
                          : "border-white/10 bg-black/20 hover:border-white/20",
                      )}
                    >
                      <p className="text-sm font-semibold text-slate-100">{player.name}</p>
                      <p className="mt-1 text-xs text-slate-400">@{player.username}</p>
                    </button>
                  )
                })}
              </div>

              <button
                type="submit"
                disabled={busy || !selectedMatchId}
                className="rounded-xl bg-[linear-gradient(135deg,#60a5fa,#3b82f6)] px-8 py-3 text-sm font-bold text-white shadow-[0_4px_24px_rgba(59,130,246,0.3)] transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Saving..." : "Save Match Players"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
