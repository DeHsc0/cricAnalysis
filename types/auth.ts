interface TokenPayload {

    username : string,
    role : "player" | "admin" | "video_analyst",
    iat : number
}

export { type TokenPayload }