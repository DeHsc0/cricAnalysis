
"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

type Role = "player" | "video_analyst"
type Gender = "men" | "women"
type Category = "under_14" | "under_16" | "under_19" | "under_23" | "ranji" | "senior"

interface User {
    id: string
    username: string
    name: string
    role: Role
    gender: Gender | null
    category: Category | null
    created_at: string
}

interface FormState {
    username: string
    password: string
    name: string
    role: Role
    gender: Gender
    category: Category | ""
}

interface EditFormState {
    username: string
    password: string
    name: string
    role: Role
    gender: Gender
    category: Category | ""
}

const MEN_CATEGORIES = ["under_14", "under_16", "under_19", "under_23", "ranji"] as const
const WOMEN_CATEGORIES = ["under_16", "under_19", "under_23", "senior"] as const

const formatCategory = (cat?: string | null) =>
    cat ? cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "-"

const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    })

const inputClass =
    "w-full rounded-[10px] border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-2 focus:ring-blue-500/20"

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
    }
> = {
    dark: {
        pageBg: "bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)]",
        glowOverlay:
            "bg-[radial-gradient(ellipse_at_20%_50%,rgba(59,130,246,0.06)_0%,transparent_60%),radial-gradient(ellipse_at_80%_20%,rgba(96,165,250,0.04)_0%,transparent_50%)]",
        gridOverlay:
            "bg-[length:48px_48px] bg-[linear-gradient(rgba(59,130,246,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.04)_1px,transparent_1px)]",
        chip: "border border-blue-500/25 bg-blue-500/10 text-blue-200",
        themeButton: "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
    },
    light: {
        pageBg: "bg-[linear-gradient(135deg,#f8fbff_0%,#eef3ff_52%,#f8fafc_100%)]",
        glowOverlay:
            "bg-[radial-gradient(ellipse_at_20%_50%,rgba(59,130,246,0.12)_0%,transparent_58%),radial-gradient(ellipse_at_80%_20%,rgba(14,165,233,0.08)_0%,transparent_48%)]",
        gridOverlay:
            "bg-[length:48px_48px] bg-[linear-gradient(rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)]",
        chip: "border border-blue-300/70 bg-blue-100/90 text-blue-900",
        themeButton: "border-slate-300 bg-white/80 text-slate-700 hover:bg-slate-100",
    },
}

const isDashboardTheme = (value: string): value is DashboardTheme => value === "dark" || value === "light"

interface AdminPageClientProps {
    adminId: string
}

export default function AdminPageClient({ adminId }: AdminPageClientProps) {
    const [activeTab, setActiveTab] = useState<"overview" | "create">("overview")
    const [filterRole, setFilterRole] = useState<"all" | Role>("all")
    const [theme, setTheme] = useState<DashboardTheme>("dark")
    const [users, setUsers] = useState<User[]>([])
    const [loadingUsers, setLoadingUsers] = useState(true)
    const [usersError, setUsersError] = useState<string | null>(null)

    const [form, setForm] = useState<FormState>({
        username: "",
        password: "",
        name: "",
        role: "player",
        gender: "men",
        category: "",
    })
    const [submitting, setSubmitting] = useState(false)
    const [loggingOut, setLoggingOut] = useState(false)
    const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
    const [overviewBanner, setOverviewBanner] = useState<{ ok: boolean; msg: string } | null>(null)
    const [submitResult, setSubmitResult] = useState<{ ok: boolean; msg: string } | null>(null)
    const [showPassword, setShowPassword] = useState(false)
    const [editModalOpen, setEditModalOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<User | null>(null)
    const [editSubmitting, setEditSubmitting] = useState(false)
    const [showEditPassword, setShowEditPassword] = useState(false)
    const [editForm, setEditForm] = useState<EditFormState>({
        username: "",
        password: "",
        name: "",
        role: "player",
        gender: "men",
        category: "",
    })

    const categories = form.gender === "men" ? MEN_CATEGORIES : WOMEN_CATEGORIES
    const editCategories = editForm.gender === "men" ? MEN_CATEGORIES : WOMEN_CATEGORIES
    const themeClasses = dashboardThemeClasses[theme]

    const fetchUsers = async () => {
        setLoadingUsers(true)
        setUsersError(null)

        try {
            const response = await fetch(`/api/admin/${adminId}/getUsers`, {
                method: "GET",
                cache: "no-store",
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data?.message || "Failed to fetch users")
            }

            const fetchedUsers = Array.isArray(data?.users) ? data.users as User[] : []
            setUsers(fetchedUsers)
        } catch (error) {
            setUsersError(error instanceof Error ? error.message : "Failed to load users")
            setUsers([])
        } finally {
            setLoadingUsers(false)
        }
    }

    useEffect(() => {
        void fetchUsers()
    }, [adminId])

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
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to logout"
            setUsersError(message)
            setSubmitResult({ ok: false, msg: message })
            setLoggingOut(false)
        }
    }

    const handleChange = (field: keyof FormState, value: string) => {
        setForm((prev) => {
            const next = { ...prev, [field]: value }
            if (field === "gender") next.category = ""
            return next
        })
    }

    const handleEditChange = (field: keyof EditFormState, value: string) => {
        setEditForm((prev) => {
            const next = { ...prev, [field]: value }
            if (field === "gender") next.category = ""
            return next
        })
    }

    const openEditModal = (user: User) => {
        setEditingUser(user)
        setEditForm({
            username: user.username,
            password: "",
            name: user.name,
            role: user.role,
            gender: user.gender ?? "men",
            category: user.category ?? "",
        })
        setShowEditPassword(false)
        setEditModalOpen(true)
        setOverviewBanner(null)
    }

    const closeEditModal = () => {
        setEditModalOpen(false)
        setEditingUser(null)
        setEditForm({
            username: "",
            password: "",
            name: "",
            role: "player",
            gender: "men",
            category: "",
        })
        setShowEditPassword(false)
        setEditSubmitting(false)
    }

    const handleEditUser = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!editingUser) return

        if (!editForm.category) {
            setOverviewBanner({ ok: false, msg: "Please select a category." })
            return
        }

        if (editingUser.role !== editForm.role) {
            const roleSwitchWarning =
                editingUser.role === "player"
                    ? `Change ${editingUser.name} from player to video analyst? This will delete the player's CDN folder and player video links before role conversion.`
                    : `Change ${editingUser.name} from video analyst to player? This only works if the analyst has no tournaments and no uploaded videos.`

            const confirmed = window.confirm(roleSwitchWarning)
            if (!confirmed) return
        }

        setEditSubmitting(true)
        setOverviewBanner(null)

        try {
            const payload: Record<string, unknown> = {
                userId: editingUser.id,
                username: editForm.username.trim(),
                name: editForm.name.trim(),
                role: editForm.role,
                gender: editForm.gender,
                category: editForm.category,
            }

            const trimmedPassword = editForm.password.trim()
            if (trimmedPassword.length > 0) {
                payload.password = trimmedPassword
            }

            const response = await fetch("/api/admin/edit_user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            })

            const data = await response.json()

            if (!response.ok || !data?.success) {
                throw new Error(data?.message || "Failed to update user")
            }

            await fetchUsers()
            closeEditModal()
            setOverviewBanner({
                ok: true,
                msg: data?.message || `${editForm.name} updated successfully.`,
            })
        } catch (error) {
            setOverviewBanner({
                ok: false,
                msg: error instanceof Error ? error.message : "Failed to update user",
            })
            setEditSubmitting(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!form.category) return
        setSubmitting(true)
        setSubmitResult(null)

        try {
            const response = await fetch("/api/admin/create_user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username: form.username,
                    password: form.password,
                    name: form.name,
                    role: form.role,
                    gender: form.gender,
                    category: form.category,
                }),
            })

            const data = await response.json()

            if (!response.ok || !data?.success) {
                throw new Error(data?.message || "Failed to create user")
            }

            setSubmitResult({
                ok: true,
                msg: data?.message || `${form.role === "player" ? "Player" : "Video Analyst"} \"${form.name}\" created successfully.`,
            })

            setForm({ username: "", password: "", name: "", role: "player", gender: "men", category: "" })
            await fetchUsers()
        } catch (error) {
            setSubmitResult({
                ok: false,
                msg: error instanceof Error ? error.message : "Failed to create user",
            })
        } finally {
            setSubmitting(false)
        }
    }

    const handleDeleteUser = async (user: User) => {
        setOverviewBanner(null)

        const warning =
            user.role === "player"
                ? `Delete ${user.name}? This will also delete the player's CDN folder (playerName_databaseId) and all videos mapped to this player.`
                : `Delete ${user.name}? This will also delete tournaments and matches created by this analyst, related videos, and CDN content.`

        const confirmed = window.confirm(warning)
        if (!confirmed) return

        setDeletingUserId(user.id)

        try {
            const response = await fetch("/api/admin/delete_user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ userId: user.id }),
            })

            const data = await response.json()

            if (!response.ok || !data?.success) {
                throw new Error(data?.message || "Failed to delete user")
            }

            await fetchUsers()

            setOverviewBanner({
                ok: true,
                msg: data?.message || `${user.name} deleted successfully.`,
            })
        } catch (error) {
            setOverviewBanner({
                ok: false,
                msg: error instanceof Error ? error.message : "Failed to delete user",
            })
        } finally {
            setDeletingUserId(null)
        }
    }

    const filtered = filterRole === "all" ? users : users.filter((u) => u.role === filterRole)
    const playerCount = users.filter((u) => u.role === "player").length
    const analystCount = users.filter((u) => u.role === "video_analyst").length

    return (
        <div
            className={cn(
                "dashboard-theme-root relative min-h-screen overflow-x-hidden font-['DM_Sans','Segoe_UI',sans-serif]",
                themeClasses.pageBg,
                theme === "light" ? "dashboard-theme-light text-slate-900" : "dashboard-theme-dark text-white",
            )}
        >
            <div className={cn("pointer-events-none fixed inset-0", themeClasses.glowOverlay)} />
            <div className={cn("pointer-events-none fixed inset-0", themeClasses.gridOverlay)} />

            <div className="relative mx-auto max-w-[1100px] px-6 pb-20 pt-10">
                <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-blue-500">Administration</p>
                        <h1 className="m-0 bg-[linear-gradient(135deg,#ffffff_0%,#94a3b8_100%)] bg-clip-text text-3xl font-bold tracking-[-0.02em] text-transparent md:text-[32px]">
                            User Management
                        </h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                            className={cn(
                                "rounded-lg border px-4 py-2 text-xs font-semibold transition",
                                themeClasses.themeButton,
                            )}
                        >
                            {theme === "dark" ? "Light Theme" : "Dark Theme"}
                        </button>
                        <div className={cn("inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold", themeClasses.chip)}>
                            <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
                            Admin
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

                <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                        { label: "Total Users", value: users.length, icon: "👥" },
                        { label: "Players", value: playerCount, icon: "🏏" },
                        { label: "Video Analysts", value: analystCount, icon: "🎬" },
                    ].map((s) => (
                        <div
                            key={s.label}
                            className="flex items-center gap-4 rounded-[14px] border border-white/10 bg-slate-950/70 px-6 py-5 backdrop-blur-xl"
                        >
                            <span className="text-[28px]">{s.icon}</span>
                            <div>
                                <p className="m-0 text-[28px] font-bold leading-none">{s.value}</p>
                                <p className="mt-1 text-xs tracking-[0.03em] text-gray-500">{s.label}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mb-5 inline-flex w-fit gap-1 rounded-xl border border-white/10 bg-slate-950/60 p-1">
                    {(["overview", "create"] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => {
                                setActiveTab(tab)
                                setSubmitResult(null)
                            }}
                            className={cn(
                                "rounded-[9px] px-[22px] py-2.5 text-sm font-semibold tracking-[0.01em] transition",
                                activeTab === tab
                                    ? "bg-blue-500/15 text-blue-200 shadow-[0_0_0_1px_rgba(59,130,246,0.3)]"
                                    : "text-gray-400 hover:text-gray-300",
                            )}
                        >
                            {tab === "overview" ? "📋  User Overview" : "➕  Create User"}
                        </button>
                    ))}
                </div>

                {activeTab === "overview" && (
                    <div className="rounded-[18px] border border-white/10 bg-slate-950/75 p-7 backdrop-blur-2xl">
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="m-0 text-base font-semibold tracking-[-0.01em] text-slate-200">All Users</p>
                            <div className="flex gap-1.5">
                                {(["all", "player", "video_analyst"] as const).map((r) => (
                                    <button
                                        key={r}
                                        onClick={() => setFilterRole(r)}
                                        className={cn(
                                            "rounded-lg border border-white/10 px-4 py-1.5 text-xs font-semibold tracking-[0.02em] transition",
                                            filterRole === r
                                                ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                                                : "text-gray-400 hover:text-gray-300",
                                        )}
                                    >
                                        {r === "all" ? "All" : r === "player" ? "Players" : "Analysts"}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {overviewBanner && (
                            <div
                                className={cn(
                                    "mb-4 rounded-[10px] border px-4 py-3 text-sm font-semibold",
                                    overviewBanner.ok
                                        ? "border-green-400/30 bg-green-500/10 text-green-300"
                                        : "border-red-400/30 bg-red-500/10 text-red-300",
                                )}
                            >
                                {overviewBanner.ok ? "✓" : "✗"} {overviewBanner.msg}
                            </div>
                        )}

                        {loadingUsers ? (
                            <div className="flex items-center justify-center py-[60px]">
                                <p className="text-gray-500">Loading users...</p>
                            </div>
                        ) : usersError ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-[60px]">
                                <p className="text-red-300">{usersError}</p>
                                <button
                                    type="button"
                                    onClick={() => void fetchUsers()}
                                    className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="flex items-center justify-center py-[60px]">
                                <p className="text-gray-500">No users found.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-[10px] border border-white/10">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr>
                                            {["Name", "Username", "Role", "Gender", "Category", "Created", "Actions"].map((h) => (
                                                <th
                                                    key={h}
                                                    className="whitespace-nowrap border-b border-white/10 bg-black/20 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500"
                                                >
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((u, i) => (
                                            <tr key={u.id} className={cn("transition-colors", i % 2 === 0 ? "bg-white/[0.02]" : "") }>
                                                <td className="border-b border-white/[0.04] px-4 py-[13px] text-sm font-semibold text-slate-100">
                                                    {u.name}
                                                </td>
                                                <td className="whitespace-nowrap border-b border-white/[0.04] px-4 py-[13px] text-sm text-slate-300">
                                                    <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs text-slate-400">
                                                        @{u.username}
                                                    </span>
                                                </td>
                                                <td className="whitespace-nowrap border-b border-white/[0.04] px-4 py-[13px] text-sm text-slate-300">
                                                    <span
                                                        className={cn(
                                                            "rounded-md border px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em]",
                                                            u.role === "player"
                                                                ? "border-blue-500/30 bg-blue-500/15 text-blue-200"
                                                                : "border-violet-500/30 bg-violet-500/15 text-violet-300",
                                                        )}
                                                    >
                                                        {u.role === "player" ? "🏏 Player" : "🎬 Analyst"}
                                                    </span>
                                                </td>
                                                <td className="whitespace-nowrap border-b border-white/[0.04] px-4 py-[13px] text-sm text-slate-300">
                                                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs capitalize text-slate-400">
                                                        {u.gender ?? "-"}
                                                    </span>
                                                </td>
                                                <td className="whitespace-nowrap border-b border-white/[0.04] px-4 py-[13px] text-sm text-slate-300">
                                                    {formatCategory(u.category)}
                                                </td>
                                                <td className="whitespace-nowrap border-b border-white/[0.04] px-4 py-[13px] text-xs text-gray-500">
                                                    {formatDate(u.created_at)}
                                                </td>
                                                <td className="whitespace-nowrap border-b border-white/[0.04] px-4 py-[13px] text-xs text-gray-500">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEditModal(u)}
                                                        disabled={deletingUserId === u.id}
                                                        className="mr-2 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleDeleteUser(u)}
                                                        disabled={deletingUserId === u.id}
                                                        className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        {deletingUserId === u.id ? "Deleting..." : "Delete"}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "create" && (
                    <div className="rounded-[18px] border border-white/10 bg-slate-950/75 p-7 backdrop-blur-2xl">
                        <p className="mb-5 text-base font-semibold tracking-[-0.01em] text-slate-200">Create New User</p>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="flex flex-col gap-2">
                                    <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Full Name</label>
                                    <input
                                        className={inputClass}
                                        placeholder="e.g. Rohit Sharma"
                                        value={form.name}
                                        onChange={(e) => handleChange("name", e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Username</label>
                                    <input
                                        className={inputClass}
                                        placeholder="e.g. rohit_s"
                                        value={form.username}
                                        onChange={(e) => handleChange("username", e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Password</label>
                                <div className="relative">
                                    <input
                                        className={cn(inputClass, "pr-11")}
                                        type={showPassword ? "text" : "password"}
                                        placeholder="Minimum 8 characters"
                                        value={form.password}
                                        onChange={(e) => handleChange("password", e.target.value)}
                                        minLength={8}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-0 text-base"
                                        onClick={() => setShowPassword((p) => !p)}
                                    >
                                        {showPassword ? "🙈" : "👁"}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="flex flex-col gap-2">
                                    <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Role</label>
                                    <div className="flex gap-1.5">
                                        {(["player", "video_analyst"] as Role[]).map((r) => (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => handleChange("role", r)}
                                                className={cn(
                                                    "flex-1 rounded-[9px] border border-white/10 bg-black/20 px-2 py-2.5 text-center text-sm font-semibold transition",
                                                    form.role === r
                                                        ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                                                        : "text-gray-400 hover:text-gray-300",
                                                )}
                                            >
                                                {r === "player" ? "🏏 Player" : "🎬 Analyst"}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Gender</label>
                                    <div className="flex gap-1.5">
                                        {(["men", "women"] as Gender[]).map((g) => (
                                            <button
                                                key={g}
                                                type="button"
                                                onClick={() => handleChange("gender", g)}
                                                className={cn(
                                                    "flex-1 rounded-[9px] border border-white/10 bg-black/20 px-2 py-2.5 text-center text-sm font-semibold capitalize transition",
                                                    form.gender === g
                                                        ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                                                        : "text-gray-400 hover:text-gray-300",
                                                )}
                                            >
                                                {g}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Category</label>
                                <div className="flex flex-wrap gap-2">
                                    {categories.map((cat) => (
                                        <button
                                            key={cat}
                                            type="button"
                                            onClick={() => handleChange("category", cat)}
                                            className={cn(
                                                "rounded-[9px] border border-white/10 bg-black/20 px-[18px] py-[9px] text-sm font-semibold transition",
                                                form.category === cat
                                                    ? "border-blue-500/50 bg-blue-500/20 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.2)]"
                                                    : "text-gray-400 hover:text-gray-300",
                                            )}
                                        >
                                            {formatCategory(cat)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {submitResult && (
                                <div
                                    className={cn(
                                        "rounded-[10px] border px-4 py-3 text-sm font-semibold",
                                        submitResult.ok
                                            ? "border-green-400/30 bg-green-500/10 text-green-300"
                                            : "border-red-400/30 bg-red-500/10 text-red-300",
                                    )}
                                >
                                    {submitResult.ok ? "✓" : "✗"} {submitResult.msg}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={submitting || !form.category}
                                className="self-start rounded-xl bg-[linear-gradient(135deg,#60a5fa,#3b82f6)] px-8 py-3.5 text-[15px] font-bold tracking-[0.02em] text-white shadow-[0_4px_24px_rgba(59,130,246,0.3)] transition disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {submitting ? "Creating..." : `Create ${form.role === "player" ? "Player" : "Video Analyst"}`}
                            </button>
                        </form>
                    </div>
                )}

                {editModalOpen && editingUser && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                        <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
                            <div className="mb-5 flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-base font-semibold text-slate-100">Edit User</p>
                                    <p className="mt-1 text-xs text-slate-400">
                                        @{editingUser.username} • {editingUser.role === "player" ? "Player" : "Video Analyst"}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeEditModal}
                                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
                                >
                                    Close
                                </button>
                            </div>

                            <form onSubmit={handleEditUser} className="flex flex-col gap-5">
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Full Name</label>
                                        <input
                                            className={inputClass}
                                            value={editForm.name}
                                            onChange={(e) => handleEditChange("name", e.target.value)}
                                            required
                                            disabled={editSubmitting}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Username</label>
                                        <input
                                            className={inputClass}
                                            value={editForm.username}
                                            onChange={(e) => handleEditChange("username", e.target.value)}
                                            required
                                            disabled={editSubmitting}
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">New Password (Optional)</label>
                                    <div className="relative">
                                        <input
                                            className={cn(inputClass, "pr-11")}
                                            type={showEditPassword ? "text" : "password"}
                                            placeholder="Leave empty to keep current password"
                                            value={editForm.password}
                                            onChange={(e) => handleEditChange("password", e.target.value)}
                                            minLength={8}
                                            disabled={editSubmitting}
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-0 text-base"
                                            onClick={() => setShowEditPassword((p) => !p)}
                                        >
                                            {showEditPassword ? "🙈" : "👁"}
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Role</label>
                                        <div className="flex gap-1.5">
                                            {(["player", "video_analyst"] as Role[]).map((r) => (
                                                <button
                                                    key={r}
                                                    type="button"
                                                    onClick={() => handleEditChange("role", r)}
                                                    disabled={editSubmitting}
                                                    className={cn(
                                                        "flex-1 rounded-[9px] border border-white/10 bg-black/20 px-2 py-2.5 text-center text-sm font-semibold transition",
                                                        editForm.role === r
                                                            ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                                                            : "text-gray-400 hover:text-gray-300",
                                                    )}
                                                >
                                                    {r === "player" ? "🏏 Player" : "🎬 Analyst"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Gender</label>
                                        <div className="flex gap-1.5">
                                            {(["men", "women"] as Gender[]).map((g) => (
                                                <button
                                                    key={g}
                                                    type="button"
                                                    onClick={() => handleEditChange("gender", g)}
                                                    disabled={editSubmitting}
                                                    className={cn(
                                                        "flex-1 rounded-[9px] border border-white/10 bg-black/20 px-2 py-2.5 text-center text-sm font-semibold capitalize transition",
                                                        editForm.gender === g
                                                            ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                                                            : "text-gray-400 hover:text-gray-300",
                                                    )}
                                                >
                                                    {g}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Category</label>
                                    <div className="flex flex-wrap gap-2">
                                        {editCategories.map((cat) => (
                                            <button
                                                key={cat}
                                                type="button"
                                                onClick={() => handleEditChange("category", cat)}
                                                disabled={editSubmitting}
                                                className={cn(
                                                    "rounded-[9px] border border-white/10 bg-black/20 px-[18px] py-[9px] text-sm font-semibold transition",
                                                    editForm.category === cat
                                                        ? "border-blue-500/50 bg-blue-500/20 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.2)]"
                                                        : "text-gray-400 hover:text-gray-300",
                                                )}
                                            >
                                                {formatCategory(cat)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <p className="rounded-lg border border-yellow-400/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                                    Role changes can trigger cleanup logic. Player to analyst conversion removes the player CDN folder and mapped player videos.
                                </p>

                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={closeEditModal}
                                        disabled={editSubmitting}
                                        className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={editSubmitting || !editForm.category}
                                        className="rounded-lg bg-blue-500/20 px-4 py-2 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {editSubmitting ? "Saving..." : "Save Changes"}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}