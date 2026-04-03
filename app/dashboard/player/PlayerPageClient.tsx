"use client";

import { useEffect, useMemo, useState } from "react";

type PlayerVideo = {
  id: string;
  player_id: string;
  tournament_id: string | null;
  match_id: string | null;
  file_name: string;
  file_type: string;
  s3_key: string;
  created_at: string;
};

type PlayerMatch = {
  id: string;
  name: string;
  created_at: string;
  videos: PlayerVideo[];
};

type PlayerTournament = {
  id: string;
  name: string;
  created_at: string;
  matches: PlayerMatch[];
};

type PlayerDashboardResponse = {
  message: string;
  success: boolean;
  role: "player";
  player?: {
    id: string;
    username: string;
    name: string;
    gender: "men" | "women";
    category: string;
  };
  tournaments?: PlayerTournament[];
};

type VideoPlayState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  videoName: string;
  src: string;
};

const formatCategory = (cat: string) =>
  cat.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface PlayerPageClientProps {
  playerId: string;
}

export default function PlayerPageClient({ playerId }: PlayerPageClientProps) {
  const [data, setData] = useState<PlayerDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [selectedTournamentId, setSelectedTournamentId] = useState<string>("");
  const [selectedMatchId, setSelectedMatchId] = useState<string>("");

  const [videoModal, setVideoModal] = useState<VideoPlayState>({
    open: false,
    loading: false,
    error: null,
    videoName: "",
    src: "",
  });

  const playerDisplayName =
    data?.player?.name?.trim() || data?.player?.username?.trim() || "Player";

  const tournaments = data?.tournaments ?? [];

  const selectedTournament = useMemo(
    () => tournaments.find((tournament) => tournament.id === selectedTournamentId) ?? null,
    [tournaments, selectedTournamentId],
  );

  const matches = selectedTournament?.matches ?? [];

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? null,
    [matches, selectedMatchId],
  );

  const videos = selectedMatch?.videos ?? [];

  const totalMatches = useMemo(
    () => tournaments.reduce((sum, tournament) => sum + tournament.matches.length, 0),
    [tournaments],
  );

  const totalVideos = useMemo(
    () => tournaments.reduce(
      (sum, tournament) =>
        sum + tournament.matches.reduce((inner, match) => inner + match.videos.length, 0),
      0,
    ),
    [tournaments],
  );

  const latestVideo = useMemo(() => {
    const allVideos = tournaments.flatMap((tournament) =>
      tournament.matches.flatMap((match) => match.videos),
    );

    if (allVideos.length === 0) return null;

    return [...allVideos].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
  }, [tournaments]);

  const goBackToTournaments = () => {
    setSelectedTournamentId("");
    setSelectedMatchId("");
  };

  const fetchPlayerDashboard = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/player/${playerId}/dashboard`, {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as PlayerDashboardResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Failed to fetch player dashboard");
      }

      setData(payload);
      // Start from top-level folder view: tournaments list first.
      setSelectedTournamentId("");
      setSelectedMatchId("");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unable to load dashboard");
      setData(null);
      setSelectedTournamentId("");
      setSelectedMatchId("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPlayerDashboard();
  }, [playerId]);

  const handleLogout = async () => {
    setLoggingOut(true);

    try {
      const response = await fetch("/api/logout", {
        method: "POST",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to logout");
      }

      window.location.href = "/login";
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Failed to logout");
      setLoggingOut(false);
    }
  };

  const closeVideoModal = () => {
    setVideoModal({
      open: false,
      loading: false,
      error: null,
      videoName: "",
      src: "",
    });
  };

  const openVideo = async (video: PlayerVideo) => {
    setVideoModal({
      open: true,
      loading: true,
      error: null,
      videoName: video.file_name,
      src: "",
    });

    try {
      const response = await fetch(`/api/player/videos/${video.id}/play`, {
        method: "GET",
      });

      const payload = (await response.json()) as {
        success?: boolean;
        message?: string;
        video?: { url?: string; file_name?: string };
      };

      if (!response.ok || !payload.success || !payload.video?.url) {
        throw new Error(payload.message || "Unable to play this video");
      }

      setVideoModal({
        open: true,
        loading: false,
        error: null,
        videoName: payload.video.file_name || video.file_name,
        src: payload.video.url,
      });
    } catch (playError) {
      setVideoModal({
        open: true,
        loading: false,
        error: playError instanceof Error ? playError.message : "Unable to play this video",
        videoName: video.file_name,
        src: "",
      });
    }
  };

  if (loading) {
    return (
      <div className="relative min-h-screen bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)]">
        <div className="mx-auto flex min-h-screen max-w-275 items-center justify-center px-6">
          <p className="text-sm text-slate-300">Loading player dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data?.player) {
    return (
      <div className="relative min-h-screen bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)]">
        <div className="mx-auto flex min-h-screen max-w-275 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-red-300">{error || "Unable to load player dashboard"}</p>
          <button
            type="button"
            onClick={() => void fetchPlayerDashboard()}
            className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)] font-['DM_Sans','Segoe_UI',sans-serif] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(59,130,246,0.06)_0%,transparent_60%),radial-gradient(ellipse_at_80%_20%,rgba(96,165,250,0.04)_0%,transparent_50%)]" />
      <div className="pointer-events-none fixed inset-0 bg-size-[48px_48px] bg-[linear-gradient(rgba(59,130,246,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.04)_1px,transparent_1px)]" />

      <div className="relative mx-auto max-w-275 px-6 pb-20 pt-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-blue-400">Dashboard</p>
            <h1 className="m-0 bg-[linear-gradient(135deg,#ffffff_0%,#94a3b8_100%)] bg-clip-text text-3xl font-bold tracking-[-0.02em] text-transparent md:text-[32px]">
              {playerDisplayName}
            </h1>
            <p className="mt-1 text-sm text-slate-400">Video Library Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/10 px-4 py-2 text-[13px] font-semibold text-blue-200">
              <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
              {formatCategory(data.player.gender)} {formatCategory(data.player.category)}
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

        <section className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Tournaments", value: tournaments.length, icon: "🏆" },
            { label: "Matches", value: totalMatches, icon: "📌" },
            { label: "Videos", value: totalVideos, icon: "🎥" },
            {
              label: "Latest Upload",
              value: latestVideo ? formatDate(latestVideo.created_at) : "-",
              icon: "🕒",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-[14px] border border-white/10 bg-slate-950/70 px-5 py-4 backdrop-blur-xl"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-slate-400">
                {card.icon} {card.label}
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-100">{card.value}</p>
            </div>
          ))}
        </section>

        {!selectedTournamentId && (
          <section className="rounded-[18px] border border-white/10 bg-slate-950/75 p-5 backdrop-blur-2xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-100">Your Tournaments</h2>
            </div>

            <div className="space-y-3">
              {tournaments.length === 0 ? (
                <p className="text-sm text-slate-500">No tournaments found.</p>
              ) : (
                tournaments.map((tournament) => {
                  const tournamentVideoCount = tournament.matches.reduce(
                    (sum, match) => sum + match.videos.length,
                    0,
                  );

                  return (
                    <button
                      key={tournament.id}
                      type="button"
                      onClick={() => {
                        setSelectedTournamentId(tournament.id);
                        setSelectedMatchId("");
                      }}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-left text-slate-300 transition hover:border-white/20"
                    >
                      <p className="text-base font-semibold text-slate-100">{tournament.name}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {tournament.matches.length} match(es) • {tournamentVideoCount} video(s)
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Created: {formatDate(tournament.created_at)}</p>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {selectedTournamentId && !selectedMatchId && selectedTournament && (
          <section className="rounded-[18px] border border-white/10 bg-slate-950/75 p-5 backdrop-blur-2xl">
            <div className="mb-4">
              <div className="mb-3 flex justify-start">
                <button
                  type="button"
                  onClick={goBackToTournaments}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
                >
                  Back To Tournaments
                </button>
              </div>
              <h2 className="mt-1 text-lg font-semibold text-slate-100">Matches In {selectedTournament.name}</h2>
            </div>

            <div className="space-y-3">
              {matches.length === 0 ? (
                <p className="text-sm text-slate-500">No matches found in this tournament.</p>
              ) : (
                matches.map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => setSelectedMatchId(match.id)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-left text-slate-300 transition hover:border-white/20"
                  >
                    <p className="text-base font-semibold text-slate-100">{match.name}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {match.videos.length} video(s)
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Created: {formatDate(match.created_at)}</p>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {selectedMatchId && selectedTournament && selectedMatch && (
          <section className="rounded-[18px] border border-white/10 bg-slate-950/75 p-5 backdrop-blur-2xl">
            <div className="mb-4">
              <div className="mb-3 flex justify-start">
                <button
                  type="button"
                  onClick={goBackToTournaments}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
                >
                  Back To Tournaments
                </button>
              </div>
              <h2 className="mt-1 text-lg font-semibold text-slate-100">Videos In {selectedMatch.name}</h2>
              <p className="mt-1 text-sm text-slate-400">
                Tournament: {selectedTournament.name}
              </p>
            </div>

            <div className="space-y-3">
              {videos.length === 0 ? (
                <p className="text-sm text-slate-500">No videos found for this match.</p>
              ) : (
                videos.map((video, index) => (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() => void openVideo(video)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-left text-slate-300 transition hover:border-white/20"
                  >
                    <p className="text-base font-semibold text-slate-100">Video {index + 1}: {video.file_name}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Uploaded: {formatDateTime(video.created_at)}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      {videoModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-white/15 bg-slate-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-slate-100">Now Playing</p>
                <p className="mt-1 text-xs text-slate-400">{videoModal.videoName}</p>
              </div>
              <button
                type="button"
                onClick={closeVideoModal}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
              >
                Close
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              {videoModal.loading ? (
                <div className="flex h-90 items-center justify-center text-sm text-slate-400">
                  Fetching video...
                </div>
              ) : videoModal.error ? (
                <div className="flex h-90 items-center justify-center text-sm text-red-300">
                  {videoModal.error}
                </div>
              ) : (
                <video
                  key={videoModal.src}
                  src={videoModal.src}
                  controls
                  autoPlay
                  className="h-90 w-full rounded-lg bg-black object-contain"
                >
                  Your browser does not support video playback.
                </video>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
