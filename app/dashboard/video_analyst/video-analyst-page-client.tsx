"use client"

import { useEffect, useMemo, useState } from "react"
import z from "zod"

import { cn } from "@/lib/utils"
import { uploadVideos } from "@/lib/upload-videos"
import { createMatchSchema, createTournamentSchema } from "@/types/zod"

type Gender = "men" | "women"
type Category = "under_14" | "under_16" | "under_19" | "under_23" | "ranji" | "senior"
type DashboardTab = "overview" | "tournaments" | "matches" | "access" | "adhoc"

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
  tournament_id?: string | null
  match_id?: string | null
  file_name: string
  file_type: string
  s3_key: string
  created_at: string
}

type PendingVideo = {
  id: string
  file: File
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

const addPlayersSchema = z.object({
  matchId: z.string().uuid("Invalid match ID"),
  playerIdsToAdd: z.array(z.string().uuid("Invalid player ID")).default([]),
  playerIdsToRevoke: z.array(z.string().uuid("Invalid player ID")).default([]),
})

const deleteMatchSchema = z.object({
  matchId: z.string().uuid("Invalid match ID"),
})

const deleteTournamentSchema = z.object({
  tournamentId: z.string().uuid("Invalid tournament ID"),
})

const formatCategory = (cat: string) => cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-2 focus:ring-blue-500/20"

type DashboardTheme = "dark" | "light"

const DASHBOARD_THEME_STORAGE_KEY = "dashboard-theme"

const dashboardThemeClasses: Record<
  DashboardTheme,
  {
    pageBg: string
    glowOverlay: string
    gridOverlay: string
    chip: string
    themeButton: string
    secondaryButton: string
  }
> = {
  dark: {
    pageBg: "bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)]",
    glowOverlay:
      "bg-[radial-gradient(ellipse_at_20%_50%,rgba(59,130,246,0.06)_0%,transparent_60%),radial-gradient(ellipse_at_80%_20%,rgba(96,165,250,0.04)_0%,transparent_50%)]",
    gridOverlay:
      "bg-size-[48px_48px] bg-[linear-gradient(rgba(59,130,246,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.04)_1px,transparent_1px)]",
    chip: "border border-blue-500/25 bg-blue-500/10 text-blue-200",
    themeButton: "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
    secondaryButton: "border-white/15 text-slate-300 hover:bg-white/5",
  },
  light: {
    pageBg: "bg-[linear-gradient(135deg,#f8fbff_0%,#eef3ff_52%,#f8fafc_100%)]",
    glowOverlay:
      "bg-[radial-gradient(ellipse_at_20%_50%,rgba(59,130,246,0.12)_0%,transparent_58%),radial-gradient(ellipse_at_80%_20%,rgba(14,165,233,0.08)_0%,transparent_48%)]",
    gridOverlay:
      "bg-size-[48px_48px] bg-[linear-gradient(rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)]",
    chip: "border border-blue-300/70 bg-blue-100/90 text-blue-900",
    themeButton: "border-slate-300 bg-white/80 text-slate-700 hover:bg-slate-100",
    secondaryButton: "border-slate-300 text-slate-700 hover:bg-slate-100",
  },
}

const isDashboardTheme = (value: string): value is DashboardTheme => value === "dark" || value === "light"

interface VideoAnalystPageClientProps {
  analystId: string
}

export default function VideoAnalystPageClient({ analystId }: VideoAnalystPageClientProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview")
  const [theme, setTheme] = useState<DashboardTheme>("dark")
  const [data, setData] = useState<AnalystDataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null)

  const [tournamentName, setTournamentName] = useState("")
  const [selectedTournamentId, setSelectedTournamentId] = useState("")
  const [selectedTournamentForMatchList, setSelectedTournamentForMatchList] = useState("all")
  const [matchName, setMatchName] = useState("")
  const [selectedMatchId, setSelectedMatchId] = useState("")
  const [selectedViewerIds, setSelectedViewerIds] = useState<string[]>([])
  const [viewerDraftByMatch, setViewerDraftByMatch] = useState<Record<string, string[]>>({})
  const [pendingVideosByMatch, setPendingVideosByMatch] = useState<Record<string, PendingVideo[]>>({})
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadModalMatchId, setUploadModalMatchId] = useState<string | null>(null)
  const [uploadModalMatchTitle, setUploadModalMatchTitle] = useState("")
  const [uploadModalDragging, setUploadModalDragging] = useState(false)
  const [uploadProgressLabel, setUploadProgressLabel] = useState<string | null>(null)
  const [uploadTargetPlayerIds, setUploadTargetPlayerIds] = useState<string[]>([])
  const [adhocPlayerId, setAdhocPlayerId] = useState("")
  const [adhocPendingVideos, setAdhocPendingVideos] = useState<PendingVideo[]>([])
  const [adhocDragging, setAdhocDragging] = useState(false)
  const [adhocProgressLabel, setAdhocProgressLabel] = useState<string | null>(null)
  const [accessModalOpen, setAccessModalOpen] = useState(false)
  const [accessModalMatchId, setAccessModalMatchId] = useState<string | null>(null)
  const [accessModalMatchTitle, setAccessModalMatchTitle] = useState("")
  const [accessModalInitialIds, setAccessModalInitialIds] = useState<string[]>([])

  const themeClasses = dashboardThemeClasses[theme]

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

  const modalPlayersWithAccess = useMemo(() => {
    if (!accessModalMatchId) return []
    const selectedIds = viewerDraftByMatch[accessModalMatchId] ?? []
    return playersSamePool.filter((player) => selectedIds.includes(player.id))
  }, [accessModalMatchId, playersSamePool, viewerDraftByMatch])

  const modalPlayersWithoutAccess = useMemo(() => {
    if (!accessModalMatchId) return []
    const selectedIds = viewerDraftByMatch[accessModalMatchId] ?? []
    return playersSamePool.filter((player) => !selectedIds.includes(player.id))
  }, [accessModalMatchId, playersSamePool, viewerDraftByMatch])

  const modalAccessDiff = useMemo(() => {
    if (!accessModalMatchId) {
      return { playerIdsToAdd: [] as string[], playerIdsToRevoke: [] as string[] }
    }

    const currentIds = viewerDraftByMatch[accessModalMatchId] ?? []
    const initialSet = new Set(accessModalInitialIds)
    const currentSet = new Set(currentIds)

    const playerIdsToAdd = currentIds.filter((id) => !initialSet.has(id))
    const playerIdsToRevoke = accessModalInitialIds.filter((id) => !currentSet.has(id))

    return {
      playerIdsToAdd,
      playerIdsToRevoke,
    }
  }, [accessModalInitialIds, accessModalMatchId, viewerDraftByMatch])

  const filteredMatchesWithTournament = useMemo(() => {
    if (selectedTournamentForMatchList === "all") return matchesWithTournament
    return matchesWithTournament.filter((match) => match.tournamentId === selectedTournamentForMatchList)
  }, [matchesWithTournament, selectedTournamentForMatchList])

  const uploadModalMatch = useMemo(() => {
    if (!uploadModalMatchId) return null
    return matchesWithTournament.find((match) => match.id === uploadModalMatchId) ?? null
  }, [matchesWithTournament, uploadModalMatchId])

  const adhocUploadedVideos = useMemo(
    () => (data?.uploaded_videos ?? []).filter((video) => !video.match_id && !video.tournament_id),
    [data?.uploaded_videos],
  )

  const selectedAdhocPlayer = useMemo(
    () => playersSamePool.find((player) => player.id === adhocPlayerId) ?? null,
    [adhocPlayerId, playersSamePool],
  )

  const adhocVideosForSelectedPlayer = useMemo(() => {
    if (!adhocPlayerId) return adhocUploadedVideos
    return adhocUploadedVideos.filter((video) => video.player_id === adhocPlayerId)
  }, [adhocPlayerId, adhocUploadedVideos])

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
      const nextPlayersPool = payload.players_same_gender_category ?? []

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

      if (nextPlayersPool.length > 0) {
        setAdhocPlayerId((prev) =>
          nextPlayersPool.some((player) => player.id === prev) ? prev : nextPlayersPool[0].id,
        )
      } else {
        setAdhocPlayerId("")
      }
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

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY)
    if (savedTheme && isDashboardTheme(savedTheme)) {
      setTheme(savedTheme)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, theme)
  }, [theme])

  const handleLogout = async () => {
    setLoggingOut(true)

    try {
      const response = await fetch("/api/logout", {
        method: "POST",
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.message || "Failed to logout")
      }

      window.location.href = "/login"
    } catch (logoutError) {
      setBanner({
        ok: false,
        msg: logoutError instanceof Error ? logoutError.message : "Failed to logout",
      })
      setLoggingOut(false)
    }
  }

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

  const handleDeleteTournament = async (tournamentId: string, tournamentName: string) => {
    setBanner(null)

    const parsed = deleteTournamentSchema.safeParse({ tournamentId })
    if (!parsed.success) {
      setBanner({ ok: false, msg: parsed.error.issues[0]?.message ?? "Invalid tournament ID" })
      return
    }

    const confirmed = window.confirm(
      `Delete ${tournamentName}?\n\nHeads up: all matches in this tournament will be deleted. All CDN videos for this tournament will also be deleted, and tournament folders for players who were part of matches in this tournament will be removed.`,
    )

    if (!confirmed) return

    setBusy(true)

    try {
      const response = await fetch("/api/video_analyst/delete_tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })

      const result = await response.json()

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || result?.error || "Could not delete tournament")
      }

      setPendingVideosByMatch((prev) => {
        const next = { ...prev }
        for (const match of matchesWithTournament) {
          if (match.tournamentId === tournamentId) {
            delete next[match.id]
          }
        }
        return next
      })

      await fetchAnalystData()

      setBanner({
        ok: true,
        msg:
          result?.cdnCleanup?.failedObjects > 0
            ? "Tournament deleted, but some CDN objects could not be deleted automatically."
            : "Tournament deleted and CDN folders/videos were cleaned up.",
      })
    } catch (deleteError) {
      setBanner({
        ok: false,
        msg: deleteError instanceof Error ? deleteError.message : "Could not delete tournament",
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteMatch = async (matchId: string, matchName: string, tournamentName: string) => {
    setBanner(null)

    const parsed = deleteMatchSchema.safeParse({ matchId })
    if (!parsed.success) {
      setBanner({ ok: false, msg: parsed.error.issues[0]?.message ?? "Invalid match ID" })
      return
    }

    const confirmed = window.confirm(
      `Delete ${matchName} from ${tournamentName}?\n\nHeads up: all videos stored in CDN for this match will be deleted. If this is the only match for a player in this tournament, that player's tournament folder will also be deleted.`,
    )

    if (!confirmed) return

    setBusy(true)

    try {
      const response = await fetch("/api/video_analyst/delete_match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })

      const result = await response.json()

      if (!response.ok || !result?.success) {
        throw new Error(result?.message || result?.error || "Could not delete match")
      }

      setPendingVideosByMatch((prev) => {
        const next = { ...prev }
        delete next[matchId]
        return next
      })

      await fetchAnalystData()

      setBanner({
        ok: true,
        msg:
          result?.cdnCleanup?.failedObjects > 0
            ? "Match deleted, but some CDN objects could not be deleted automatically."
            : "Match deleted and CDN videos were cleaned up.",
      })
    } catch (deleteError) {
      setBanner({
        ok: false,
        msg: deleteError instanceof Error ? deleteError.message : "Could not delete match",
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

  const openAccessModal = (matchId: string, matchName: string, tournamentName: string, currentPlayerIds: string[]) => {
    setAccessModalMatchId(matchId)
    setAccessModalMatchTitle(`${matchName} • ${tournamentName}`)
    setAccessModalInitialIds(currentPlayerIds)
    setViewerDraftByMatch((prev) => ({
      ...prev,
      [matchId]: currentPlayerIds,
    }))
    setAccessModalOpen(true)
  }

  const closeAccessModal = () => {
    setAccessModalOpen(false)
    setAccessModalMatchId(null)
    setAccessModalMatchTitle("")
    setAccessModalInitialIds([])
  }

  const revokePlayerAccess = (playerId: string) => {
    if (!accessModalMatchId) return

    setViewerDraftByMatch((prev) => {
      const current = prev[accessModalMatchId] ?? []
      return {
        ...prev,
        [accessModalMatchId]: current.filter((id) => id !== playerId),
      }
    })
  }

  const grantPlayerAccess = (playerId: string) => {
    if (!accessModalMatchId) return

    setViewerDraftByMatch((prev) => {
      const current = prev[accessModalMatchId] ?? []
      if (current.includes(playerId)) return prev
      return {
        ...prev,
        [accessModalMatchId]: [...current, playerId],
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
      file,
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

  const openUploadModal = (matchId: string, matchName: string, tournamentName: string) => {
    setUploadModalMatchId(matchId)
    setUploadModalMatchTitle(`${matchName} • ${tournamentName}`)
    setUploadTargetPlayerIds([])
    setUploadModalDragging(false)
    setUploadModalOpen(true)
  }

  const closeUploadModal = () => {
    setUploadModalOpen(false)
    setUploadModalMatchId(null)
    setUploadModalMatchTitle("")
    setUploadModalDragging(false)
    setUploadProgressLabel(null)
    setUploadTargetPlayerIds([])
  }

  const toggleUploadTargetPlayer = (playerId: string) => {
    setUploadTargetPlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId],
    )
  }

  const handleUploadQueuedVideos = async () => {
    if (!uploadModalMatchId) return

    setBanner(null)

    const queued = pendingVideosByMatch[uploadModalMatchId] ?? []
    if (queued.length === 0) {
      setBanner({ ok: false, msg: "No videos queued for upload." })
      return
    }

    const match = matchesWithTournament.find((item) => item.id === uploadModalMatchId)
    if (!match) {
      setBanner({ ok: false, msg: "Selected match was not found." })
      return
    }

    if (match.players.length === 0) {
      setBanner({ ok: false, msg: "You need to add players to the match first." })
      return
    }

    const matchPlayerIds = new Set(match.players.map((player) => player.id))
    const selectedPlayerIds = uploadTargetPlayerIds.filter((id) => matchPlayerIds.has(id))

    if (selectedPlayerIds.length === 0) {
      setBanner({ ok: false, msg: "Select at least one player for this upload set." })
      return
    }

    const uploadTargets = queued.flatMap((video) =>
      selectedPlayerIds.map((playerId) => ({
        file: video.file,
        clientId: video.id,
        playerId,
        tournamentId: match.tournamentId,
        matchId: match.id,
      })),
    )

    setBusy(true)

    try {
      const result = await uploadVideos(uploadTargets, (fileName, pct) => {
        setUploadProgressLabel(`${fileName} • ${pct}%`)
      })

      const failedNames = Array.from(
        new Set(result.failed.map((item) => `${item.video.file.name}: ${item.error}`)),
      )

      // Clear queue after attempt to prevent accidental duplicate uploads.
      setPendingVideosByMatch((prev) => ({
        ...prev,
        [uploadModalMatchId]: [],
      }))

      await fetchAnalystData()

      if (result.failed.length === 0) {
        setBanner({
          ok: true,
          msg: `Uploaded and saved ${queued.length} file(s) for ${selectedPlayerIds.length} selected player(s).`,
        })
        closeUploadModal()
      } else {
        const preview = failedNames.slice(0, 3).join(" | ")
        setBanner({
          ok: false,
          msg: `${result.failed.length} upload target(s) failed. ${preview}${failedNames.length > 3 ? " | ..." : ""}`,
        })
      }
    } catch (uploadError) {
      setBanner({
        ok: false,
        msg: uploadError instanceof Error ? uploadError.message : "Video upload failed",
      })
    } finally {
      setBusy(false)
      setUploadProgressLabel(null)
    }
  }

  const queueAdhocVideos = (files: File[]) => {
    const onlyVideos = files.filter((file) => file.type.startsWith("video/"))

    if (onlyVideos.length === 0) {
      setBanner({ ok: false, msg: "Please select video files only." })
      return
    }

    const queued: PendingVideo[] = onlyVideos.map((file) => ({
      id: crypto.randomUUID(),
      file,
      fileName: file.name,
      sizeMb: (file.size / (1024 * 1024)).toFixed(1),
    }))

    setAdhocPendingVideos((prev) => [...prev, ...queued])
    setBanner({ ok: true, msg: `${queued.length} adhoc video(s) queued for upload.` })
  }

  const removeQueuedAdhocVideo = (pendingVideoId: string) => {
    setAdhocPendingVideos((prev) => prev.filter((video) => video.id !== pendingVideoId))
  }

  const handleUploadAdhocVideos = async () => {
    setBanner(null)

    if (!adhocPlayerId) {
      setBanner({ ok: false, msg: "Select a player for adhoc upload." })
      return
    }

    if (adhocPendingVideos.length === 0) {
      setBanner({ ok: false, msg: "No adhoc videos queued for upload." })
      return
    }

    const uploadTargets = adhocPendingVideos.map((video) => ({
      file: video.file,
      clientId: video.id,
      playerId: adhocPlayerId,
      tournamentId: null,
      matchId: null,
    }))

    setBusy(true)

    try {
      const result = await uploadVideos(uploadTargets, (fileName, pct) => {
        setAdhocProgressLabel(`${fileName} • ${pct}%`)
      })

      const failedNames = Array.from(
        new Set(result.failed.map((item) => `${item.video.file.name}: ${item.error}`)),
      )

      setAdhocPendingVideos([])
      await fetchAnalystData()

      if (result.failed.length === 0) {
        setBanner({
          ok: true,
          msg: `Uploaded and saved ${uploadTargets.length} adhoc video(s) for ${selectedAdhocPlayer?.name ?? "selected player"}.`,
        })
      } else {
        const preview = failedNames.slice(0, 3).join(" | ")
        setBanner({
          ok: false,
          msg: `${result.failed.length} adhoc upload(s) failed. ${preview}${failedNames.length > 3 ? " | ..." : ""}`,
        })
      }
    } catch (uploadError) {
      setBanner({
        ok: false,
        msg: uploadError instanceof Error ? uploadError.message : "Adhoc video upload failed",
      })
    } finally {
      setBusy(false)
      setAdhocProgressLabel(null)
      setAdhocDragging(false)
    }
  }

  const handleSavePlayers = async (e: React.FormEvent) => {
    e.preventDefault()
    setBanner(null)

    const currentMatch = matchesWithTournament.find((match) => match.id === selectedMatchId)
    const existingPlayerIds = (currentMatch?.players ?? []).map((player) => player.id)

    const existingSet = new Set(existingPlayerIds)
    const selectedSet = new Set(selectedViewerIds)

    const playerIdsToAdd = selectedViewerIds.filter((id) => !existingSet.has(id))
    const playerIdsToRevoke = existingPlayerIds.filter((id) => !selectedSet.has(id))

    if (playerIdsToAdd.length === 0 && playerIdsToRevoke.length === 0) {
      setBanner({ ok: true, msg: "No player access changes to save." })
      return
    }

    const parsed = addPlayersSchema.safeParse({
      matchId: selectedMatchId,
      playerIdsToAdd,
      playerIdsToRevoke,
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
      setBanner({ ok: true, msg: `Players access updated (+${playerIdsToAdd.length}, -${playerIdsToRevoke.length}).` })
    } catch (saveError) {
      setBanner({
        ok: false,
        msg: saveError instanceof Error ? saveError.message : "Could not update players",
      })
    } finally {
      setBusy(false)
    }
  }

  const handleSavePlayersForMatch = async () => {
    if (!accessModalMatchId) return

    setBanner(null)

    const { playerIdsToAdd, playerIdsToRevoke } = modalAccessDiff

    if (playerIdsToAdd.length === 0 && playerIdsToRevoke.length === 0) {
      setBanner({ ok: true, msg: "No player access changes to save." })
      return
    }

    const parsed = addPlayersSchema.safeParse({
      matchId: accessModalMatchId,
      playerIdsToAdd,
      playerIdsToRevoke,
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
      setBanner({
        ok: true,
        msg: `Players access updated (+${playerIdsToAdd.length}, -${playerIdsToRevoke.length}).`,
      })
      closeAccessModal()
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
      <div className={`relative min-h-screen ${themeClasses.pageBg}`}>
        <div className="mx-auto flex min-h-screen max-w-275 items-center justify-center px-6">
          <p className="text-sm text-slate-300">Loading video analyst dashboard...</p>
        </div>
      </div>
    )
  }

  if (error || !data?.analyst) {
    return (
      <div className={`relative min-h-screen ${themeClasses.pageBg}`}>
        <div className="mx-auto flex min-h-screen max-w-275 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-red-300">{error || "Unable to load analyst profile"}</p>
          <button
            type="button"
            onClick={() => void fetchAnalystData()}
            className={`rounded-lg border px-4 py-2 text-xs font-semibold transition ${themeClasses.secondaryButton}`}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`dashboard-theme-root relative min-h-screen overflow-x-hidden font-['DM_Sans','Segoe_UI',sans-serif] ${themeClasses.pageBg} ${theme === "light" ? "dashboard-theme-light text-slate-900" : "dashboard-theme-dark text-white"}`}
    >
      <div className={`pointer-events-none fixed inset-0 ${themeClasses.glowOverlay}`} />
      <div className={`pointer-events-none fixed inset-0 ${themeClasses.gridOverlay}`} />

      <div className="relative mx-auto max-w-275 px-6 pb-20 pt-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-blue-500">Video Analyst</p>
            <h1 className="m-0 bg-[linear-gradient(135deg,#ffffff_0%,#94a3b8_100%)] bg-clip-text text-3xl font-bold tracking-[-0.02em] text-transparent md:text-[32px]">
              Tournament Workspace
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className={`rounded-lg border px-4 py-2 text-xs font-semibold transition ${themeClasses.themeButton}`}
            >
              {theme === "dark" ? "Light Theme" : "Dark Theme"}
            </button>
            <div className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold ${themeClasses.chip}`}>
              <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
              {formatCategory(data.analyst.gender)} {formatCategory(data.analyst.category)}
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
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
            ["adhoc", "📁 Adhoc Uploads"],
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
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{tournament.name}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatCategory(tournament.gender)} / {formatCategory(tournament.category)} • {tournament.matches.length} match(es)
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDeleteTournament(tournament.id, tournament.name)}
                        className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete Tournament
                      </button>
                    </div>
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
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{tournament.name}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatCategory(tournament.gender)} / {formatCategory(tournament.category)} • {tournament.matches.length} match(es)
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDeleteTournament(tournament.id, tournament.name)}
                        className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete Tournament
                      </button>
                    </div>
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

                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => openUploadModal(match.id, match.name, match.tournamentName)}
                        className="w-full rounded-lg border border-blue-400/30 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/20"
                      >
                        Upload Videos
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteMatch(match.id, match.name, match.tournamentName)}
                        disabled={busy}
                        className="w-full rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete Match
                      </button>
                    </div>
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

                  <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-xs text-slate-300">
                      {match.players.length} player(s) currently have access
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        openAccessModal(
                          match.id,
                          match.name,
                          match.tournamentName,
                          match.players.map((player) => player.id),
                        )
                      }
                      className="rounded-lg bg-blue-500/20 px-4 py-2 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/30"
                    >
                      Change Players Access
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

        {activeTab === "adhoc" && (
          <div className="rounded-[18px] border border-white/10 bg-slate-950/75 p-7 backdrop-blur-2xl">
            <p className="mb-2 text-base font-semibold text-slate-200">Adhoc Uploads</p>
            <p className="mb-5 text-sm text-slate-400">
              Upload multiple videos for a single player without linking them to a tournament or match.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-gray-500">
                  Select Player
                </label>
                <select
                  className={inputClass}
                  value={adhocPlayerId}
                  onChange={(e) => setAdhocPlayerId(e.target.value)}
                  disabled={busy || playersSamePool.length === 0}
                >
                  {playersSamePool.length === 0 ? (
                    <option value="" className="bg-slate-900 text-slate-100">
                      No eligible players found
                    </option>
                  ) : (
                    playersSamePool.map((player) => (
                      <option key={player.id} value={player.id} className="bg-slate-900 text-slate-100">
                        {player.name} • @{player.username}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                <p className="font-semibold text-slate-200">Upload Rule</p>
                <p className="mt-1 text-xs text-slate-400">
                  Each adhoc batch is limited to one player. Server stores files under playerName_databaseId/adhoc.
                </p>
              </div>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault()
                setAdhocDragging(true)
              }}
              onDragLeave={() => setAdhocDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setAdhocDragging(false)
                queueAdhocVideos(Array.from(e.dataTransfer.files))
              }}
              className={cn(
                "mt-5 rounded-xl border border-dashed p-6 text-center transition",
                adhocDragging ? "border-blue-400/60 bg-blue-500/10" : "border-white/20 bg-black/20",
              )}
            >
              <p className="text-sm font-semibold text-slate-100">Drag and drop adhoc video files</p>
              <p className="mt-1 text-xs text-slate-400">or choose files from your device.</p>
              <input
                type="file"
                accept="video/*"
                multiple
                className="mt-3 w-full cursor-pointer text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-blue-500/20 file:px-3 file:py-1.5 file:text-blue-200"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : []
                  queueAdhocVideos(files)
                  e.currentTarget.value = ""
                }}
              />
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Queued Adhoc Videos</p>
              {adhocPendingVideos.length === 0 ? (
                <p className="text-xs text-slate-500">No adhoc videos queued yet.</p>
              ) : (
                <div className="max-h-56 space-y-2 overflow-auto pr-1">
                  {adhocPendingVideos.map((video) => (
                    <div
                      key={video.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300"
                    >
                      <div>
                        <p className="font-medium text-slate-200">{video.fileName}</p>
                        <p className="mt-1 text-slate-400">{video.sizeMb} MB</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeQueuedAdhocVideo(video.id)}
                        className="rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {adhocProgressLabel && <p className="mt-4 text-xs text-blue-200">Uploading: {adhocProgressLabel}</p>}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdhocPendingVideos([])}
                disabled={busy || adhocPendingVideos.length === 0}
                className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Clear Queue
              </button>
              <button
                type="button"
                onClick={() => void handleUploadAdhocVideos()}
                disabled={busy || adhocPendingVideos.length === 0 || !adhocPlayerId}
                className="rounded-lg bg-blue-500/20 px-4 py-2 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Uploading..." : "Upload Adhoc Videos"}
              </button>
            </div>

            <div className="mt-7 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                Previously Uploaded Adhoc Videos
              </p>
              {adhocVideosForSelectedPlayer.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No adhoc videos uploaded yet{selectedAdhocPlayer ? ` for ${selectedAdhocPlayer.name}` : ""}.
                </p>
              ) : (
                <div className="max-h-64 space-y-2 overflow-auto pr-1">
                  {adhocVideosForSelectedPlayer.map((video) => (
                    <div key={video.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                      <p className="font-medium text-slate-200">{video.file_name}</p>
                      <p className="mt-1 text-slate-400">
                        {video.player_name} • {formatDate(video.created_at)}
                      </p>
                    </div>
                  ))}
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

        {accessModalOpen && accessModalMatchId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-slate-100">Change Players Access</p>
                  <p className="mt-1 text-xs text-slate-400">{accessModalMatchTitle}</p>
                </div>
                <button
                  type="button"
                  onClick={closeAccessModal}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Players With Access</p>
                  <div className="space-y-2">
                    {modalPlayersWithAccess.length === 0 ? (
                      <p className="text-xs text-slate-500">No players currently have access.</p>
                    ) : (
                      modalPlayersWithAccess.map((player) => (
                        <div key={player.id} className="relative rounded-lg border border-white/10 bg-white/5 p-3">
                          <button
                            type="button"
                            onClick={() => revokePlayerAccess(player.id)}
                            className="absolute right-2 top-2 h-6 w-6 rounded-md border border-red-400/30 bg-red-500/10 text-xs font-bold text-red-300"
                          >
                            ×
                          </button>
                          <p className="pr-8 text-sm font-semibold text-slate-100">{player.name}</p>
                          <p className="mt-1 text-xs text-slate-400">@{player.username}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Players Without Access</p>
                  <div className="space-y-2">
                    {modalPlayersWithoutAccess.length === 0 ? (
                      <p className="text-xs text-slate-500">All eligible players currently have access.</p>
                    ) : (
                      modalPlayersWithoutAccess.map((player) => (
                        <div key={player.id} className="relative rounded-lg border border-white/10 bg-white/5 p-3">
                          <button
                            type="button"
                            onClick={() => grantPlayerAccess(player.id)}
                            className="absolute right-2 top-2 h-6 w-6 rounded-md border border-blue-400/30 bg-blue-500/10 text-xs font-bold text-blue-300"
                          >
                            +
                          </button>
                          <p className="pr-8 text-sm font-semibold text-slate-100">{player.name}</p>
                          <p className="mt-1 text-xs text-slate-400">@{player.username}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Grant IDs: {modalAccessDiff.playerIdsToAdd.length} • Revoke IDs: {modalAccessDiff.playerIdsToRevoke.length}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeAccessModal}
                    className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSavePlayersForMatch()}
                    className="rounded-lg bg-blue-500/20 px-4 py-2 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {uploadModalOpen && uploadModalMatchId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-slate-100">Upload Videos</p>
                  <p className="mt-1 text-xs text-slate-400">{uploadModalMatchTitle}</p>
                </div>
                <button
                  type="button"
                  onClick={closeUploadModal}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
                >
                  Close
                </button>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setUploadModalDragging(true)
                }}
                onDragLeave={() => setUploadModalDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setUploadModalDragging(false)
                  queueVideosForMatch(uploadModalMatchId, Array.from(e.dataTransfer.files))
                }}
                className={cn(
                  "rounded-xl border border-dashed p-6 text-center transition",
                  uploadModalDragging ? "border-blue-400/60 bg-blue-500/10" : "border-white/20 bg-black/20",
                )}
              >
                <p className="text-sm font-semibold text-slate-100">Drag and drop multiple video files</p>
                <p className="mt-1 text-xs text-slate-400">or choose files from your device.</p>
                <input
                  type="file"
                  accept="video/*"
                  multiple
                  className="mt-3 w-full cursor-pointer text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-blue-500/20 file:px-3 file:py-1.5 file:text-blue-200"
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : []
                    queueVideosForMatch(uploadModalMatchId, files)
                    e.currentTarget.value = ""
                  }}
                />
              </div>

              <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Select Players For This Upload Set
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Choose one or more players from this match. Videos will be uploaded only to selected players.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(uploadModalMatch?.players ?? []).length === 0 ? (
                    <p className="text-xs text-slate-500">No players are currently assigned to this match.</p>
                  ) : (
                    (uploadModalMatch?.players ?? []).map((player) => {
                      const selected = uploadTargetPlayerIds.includes(player.id)
                      return (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => toggleUploadTargetPlayer(player.id)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left text-xs transition",
                            selected
                              ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                              : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20",
                          )}
                        >
                          <p className="font-semibold text-sm">{player.name}</p>
                          <p className="mt-1 text-[11px] text-slate-400">@{player.username}</p>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Queued Videos (UI only)</p>
                {(pendingVideosByMatch[uploadModalMatchId] ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">No videos queued yet.</p>
                ) : (
                  <div className="max-h-60 space-y-2 overflow-auto pr-1">
                    {(pendingVideosByMatch[uploadModalMatchId] ?? []).map((video) => (
                      <div
                        key={video.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300"
                      >
                        <div>
                          <p className="font-medium text-slate-200">{video.fileName}</p>
                          <p className="mt-1 text-slate-400">{video.sizeMb} MB</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeQueuedVideo(uploadModalMatchId, video.id)}
                          className="rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {uploadProgressLabel && (
                <p className="mt-4 text-xs text-blue-200">Uploading: {uploadProgressLabel}</p>
              )}

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeUploadModal}
                  className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleUploadQueuedVideos()}
                  disabled={
                    busy ||
                    (pendingVideosByMatch[uploadModalMatchId] ?? []).length === 0 ||
                    uploadTargetPlayerIds.length === 0
                  }
                  className="rounded-lg bg-blue-500/20 px-4 py-2 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Uploading..." : "Upload Queued Videos"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
