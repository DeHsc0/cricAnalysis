import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { TokenPayload } from "@/types/auth"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getUserId(token: string): TokenPayload | null {
  try {
    const payloadPart = token.split(".")[1]
    if (!payloadPart) return null

    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/")
    const decoded = atob(normalized)

    return JSON.parse(decoded) as TokenPayload
  } catch {
    return null
  }
}