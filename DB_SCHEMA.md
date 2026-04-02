-- ================================
-- EXTENSIONS
-- ================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================
-- ENUMS
-- ================================
CREATE TYPE user_role AS ENUM ('admin', 'video_analyst', 'player');

CREATE TYPE gender_type AS ENUM ('men', 'women');

CREATE TYPE men_category AS ENUM ('under_14', 'under_16', 'under_19', 'under_23' , 'ranji');

CREATE TYPE women_category AS ENUM ('under_16', 'under_19', 'under_23', 'senior');

-- ================================
-- USERS
-- ================================
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    VARCHAR(50) UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    name        VARCHAR(100) NOT NULL,
    role        user_role NOT NULL,
    
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- PLAYERS
-- ================================
CREATE TABLE players (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    gender      gender_type NOT NULL,
    category    VARCHAR(20) NOT NULL
    -- category values must match men_category or women_category based on gender
    -- enforced at application level
);

-- ================================
-- VIDEO ANALYSTS
-- ================================
CREATE TABLE video_analysts (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    gender      gender_type NOT NULL,
    category    VARCHAR(20) NOT NULL
    -- each analyst is assigned to exactly one gender + category pair by the admin
    -- enforced at application level
);

-- ================================
-- TOURNAMENTS
-- ================================
CREATE TABLE tournaments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name        TEXT NOT NULL,

    analyst_id  UUID NOT NULL REFERENCES video_analysts(user_id) ON DELETE RESTRICT,

    gender      gender_type NOT NULL,
    category    VARCHAR(20) NOT NULL,
    -- gender + category is inherited from the analyst who creates the tournament
    -- enforced at application level: tournament.gender === analyst.gender
    --                                tournament.category === analyst.category

    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- MATCHES
-- ================================
CREATE TABLE matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,

    name            TEXT NOT NULL,

    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- MATCH PLAYERS  (junction — which players are tagged in a match)
-- ================================
CREATE TABLE match_players (
    match_id    UUID REFERENCES matches(id) ON DELETE CASCADE,
    player_id   UUID REFERENCES players(user_id) ON DELETE CASCADE,

    PRIMARY KEY (match_id, player_id)
    -- application must ensure: player.category === tournament.category
    --                          player.gender   === tournament.gender
);

-- ================================
-- VIDEOS
-- ================================
CREATE TABLE videos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    player_id       UUID NOT NULL REFERENCES players(user_id) ON DELETE CASCADE,

    tournament_id   UUID REFERENCES tournaments(id) ON DELETE CASCADE,
    match_id        UUID REFERENCES matches(id) ON DELETE CASCADE,

    file_name       TEXT NOT NULL,
    file_type       TEXT NOT NULL,

    s3_key          TEXT NOT NULL UNIQUE,

    uploaded_by     UUID NOT NULL REFERENCES video_analysts(user_id) ON DELETE RESTRICT,

    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP

    -- application-level rules:
    --   if match_id IS NOT NULL → tournament_id must also be NOT NULL
    --   if match_id IS NOT NULL → player must exist in match_players for that match
    --   if match_id IS NULL     → adhoc video for the player
);

-- ================================
-- INDEXES
-- ================================

-- Fast lookup by username at login
CREATE INDEX idx_users_username         ON users(username);

-- Resolve role-specific rows quickly
CREATE INDEX idx_players_user           ON players(user_id);
CREATE INDEX idx_analysts_user          ON video_analysts(user_id);

-- Analyst → their tournaments
CREATE INDEX idx_tournaments_analyst    ON tournaments(analyst_id);

-- Gender + category filter on tournaments (analyst dashboard listing)
CREATE INDEX idx_tournaments_gender_cat ON tournaments(gender, category);

-- Tournament → its matches
CREATE INDEX idx_matches_tournament     ON matches(tournament_id);

-- Junction table lookups from both sides
CREATE INDEX idx_match_players_player   ON match_players(player_id);
CREATE INDEX idx_match_players_match    ON match_players(match_id);

-- Video lookups
CREATE INDEX idx_videos_player          ON videos(player_id);
CREATE INDEX idx_videos_match           ON videos(match_id);
CREATE INDEX idx_videos_tournament      ON videos(tournament_id);
CREATE INDEX idx_videos_uploaded_by     ON videos(uploaded_by);

-- Quickly find all adhoc videos for a player (tournament_id IS NULL)
CREATE INDEX idx_videos_adhoc           ON videos(player_id) WHERE tournament_id IS NULL;