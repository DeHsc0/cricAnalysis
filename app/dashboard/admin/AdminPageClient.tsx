
"use client"

import { useEffect, useState } from "react"
import bcrypt from "bcryptjs"
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

interface AdminPageClientProps {
    adminId: string
}

export default function AdminPageClient({ adminId }: AdminPageClientProps) {
    const [activeTab, setActiveTab] = useState<"overview" | "create">("overview")
    const [filterRole, setFilterRole] = useState<"all" | Role>("all")
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
    const [submitResult, setSubmitResult] = useState<{ ok: boolean; msg: string } | null>(null)
    const [showPassword, setShowPassword] = useState(false)

    const categories = form.gender === "men" ? MEN_CATEGORIES : WOMEN_CATEGORIES

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

    const handleChange = (field: keyof FormState, value: string) => {
        setForm((prev) => {
            const next = { ...prev, [field]: value }
            if (field === "gender") next.category = ""
            return next
        })
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!form.category) return
        setSubmitting(true)
        setSubmitResult(null)

        try {

            const hashedPassword = await bcrypt.hash(form.password , 12)

            const response = await fetch("/api/admin/create_user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username: form.username,
                    password: hashedPassword,
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

    const filtered = filterRole === "all" ? users : users.filter((u) => u.role === filterRole)
    const playerCount = users.filter((u) => u.role === "player").length
    const analystCount = users.filter((u) => u.role === "video_analyst").length

    return (
        <div className="relative min-h-screen overflow-x-hidden bg-[linear-gradient(135deg,#0a0f1d_0%,#0d1526_50%,#0a0f1d_100%)] text-white [font-family:'DM_Sans','Segoe_UI',sans-serif]">
            <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(59,130,246,0.06)_0%,transparent_60%),radial-gradient(ellipse_at_80%_20%,rgba(96,165,250,0.04)_0%,transparent_50%)]" />
            <div className="pointer-events-none fixed inset-0 bg-[length:48px_48px] bg-[linear-gradient(rgba(59,130,246,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.04)_1px,transparent_1px)]" />

            <div className="relative mx-auto max-w-[1100px] px-6 pb-20 pt-10">
                <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-blue-500">Administration</p>
                        <h1 className="m-0 bg-[linear-gradient(135deg,#ffffff_0%,#94a3b8_100%)] bg-clip-text text-3xl font-bold tracking-[-0.02em] text-transparent md:text-[32px]">
                            User Management
                        </h1>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/10 px-4 py-2 text-[13px] font-semibold text-blue-200">
                        <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
                        Admin
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
                                            {["Name", "Username", "Role", "Gender", "Category", "Created"].map((h) => (
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
            </div>
        </div>
    )
}