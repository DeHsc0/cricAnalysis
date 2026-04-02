export interface VideoInput {
  file: File
  playerId: string
  tournamentId?: string | null
  matchId?: string | null
  clientId?: string
}

export interface UploadResult {
  succeeded: VideoInput[]
  failed: Array<{ video: VideoInput; error: string }>
}

type SignedVideo = {
  playerId: string
  fileName: string
  fileType: string
  tournamentId: string | null
  matchId: string | null
  s3Key: string
  presignedUrl: string
}

async function uploadWithRetry(
  presignedUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
  maxRetries = 3,
): Promise<void> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", presignedUrl)
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress?.(Math.round((event.loaded / event.total) * 100))
          }
        }

        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve()
            return
          }

          reject(new Error(`S3 returned ${xhr.status}`))
        }

        xhr.onerror = () => reject(new Error("Network failure"))
        xhr.send(file)
      })

      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)))
      }
    }
  }

  throw (lastError ?? new Error("Upload failed"))
}

export async function uploadVideos(
  videos: VideoInput[],
  onProgress?: (fileName: string, pct: number) => void,
): Promise<UploadResult> {
  if (videos.length === 0) {
    return { succeeded: [], failed: [] }
  }

  const presignResponse = await fetch("/api/videos/presigned-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videos: videos.map((video) => ({
        playerId: video.playerId,
        fileName: video.file.name,
        fileType: video.file.type || "application/octet-stream",
        tournamentId: video.tournamentId ?? null,
        matchId: video.matchId ?? null,
      })),
    }),
  })

  const presignPayload = (await presignResponse.json()) as {
    success?: boolean
    message?: string
    videos?: SignedVideo[]
  }

  if (!presignResponse.ok || !presignPayload.videos) {
    throw new Error(presignPayload.message || "Failed to get presigned URLs")
  }

  const signed = presignPayload.videos

  const uploadResults = await Promise.allSettled(
    signed.map((signedVideo, index) =>
      uploadWithRetry(
        signedVideo.presignedUrl,
        videos[index].file,
        (pct) => onProgress?.(videos[index].file.name, pct),
      ).then(() => ({ signed: signedVideo, input: videos[index] })),
    ),
  )

  const succeededPairs: Array<{ signed: SignedVideo; input: VideoInput }> = []
  const failed: Array<{ video: VideoInput; error: string }> = []

  uploadResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      succeededPairs.push(result.value)
      return
    }

    failed.push({
      video: videos[index],
      error: result.reason instanceof Error ? result.reason.message : "Upload failed",
    })
  })

  if (succeededPairs.length > 0) {
    const saveResponse = await fetch("/api/videos/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videos: succeededPairs.map(({ signed: signedVideo, input }) => ({
          playerId: input.playerId,
          fileName: input.file.name,
          fileType: input.file.type || "application/octet-stream",
          s3Key: signedVideo.s3Key,
          tournamentId: input.tournamentId ?? null,
          matchId: input.matchId ?? null,
        })),
      }),
    })

    const savePayload = (await saveResponse.json()) as {
      success?: boolean
      message?: string
    }

    if (!saveResponse.ok || savePayload.success === false) {
      throw new Error(savePayload.message || "Failed to save uploaded videos")
    }
  }

  return {
    succeeded: succeededPairs.map((pair) => pair.input),
    failed,
  }
}
