-- Phase 2 durable persistence foundation.
-- State-machine constraints deliberately use text values so application releases can
-- follow expand/contract deployments without PostgreSQL enum replacement locks.

CREATE TABLE "guest_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" TEXT NOT NULL,
    "display_name_ci" TEXT GENERATED ALWAYS AS (lower("display_name")) STORED NOT NULL,
    "avatar_key" TEXT NOT NULL,
    "current_jti" UUID,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "guest_sessions_expires_after_issued_check"
        CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "guest_sessions_revoked_after_issued_check"
        CHECK ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
);

CREATE UNIQUE INDEX "guest_sessions_display_name_ci_key"
    ON "guest_sessions" ("display_name_ci");
CREATE INDEX "guest_sessions_expires_at_idx"
    ON "guest_sessions" ("expires_at");

CREATE TABLE "games" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "match_id" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'BLITZ',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "initial_fen" TEXT NOT NULL,
    "current_fen" TEXT NOT NULL,
    "turn_color" TEXT NOT NULL DEFAULT 'w',
    "pgn" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "termination" TEXT,
    "time_initial_ms" INTEGER NOT NULL,
    "increment_ms" INTEGER NOT NULL DEFAULT 0,
    "white_clock_ms" INTEGER NOT NULL,
    "black_clock_ms" INTEGER NOT NULL,
    "turn_started_at" TIMESTAMPTZ(3),
    "join_deadline_at" TIMESTAMPTZ(3),
    "reconnect_deadline_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "games_mode_check"
        CHECK ("mode" IN ('BLITZ')),
    CONSTRAINT "games_status_check"
        CHECK ("status" IN (
            'CREATED',
            'WAITING_FOR_PLAYERS',
            'READY',
            'IN_PROGRESS',
            'RECONNECTING',
            'COMPLETED',
            'ABANDONED',
            'EXPIRED'
        )),
    CONSTRAINT "games_turn_color_check"
        CHECK ("turn_color" IN ('w', 'b')),
    CONSTRAINT "games_version_check"
        CHECK ("version" >= 0),
    CONSTRAINT "games_time_initial_ms_check"
        CHECK ("time_initial_ms" > 0),
    CONSTRAINT "games_increment_ms_check"
        CHECK ("increment_ms" >= 0),
    CONSTRAINT "games_white_clock_ms_check"
        CHECK ("white_clock_ms" >= 0),
    CONSTRAINT "games_black_clock_ms_check"
        CHECK ("black_clock_ms" >= 0),
    CONSTRAINT "games_result_check"
        CHECK ("result" IS NULL OR "result" IN ('1-0', '0-1', '1/2-1/2', '*')),
    CONSTRAINT "games_termination_check"
        CHECK (
            "termination" IS NULL OR
            "termination" IN (
                'CHECKMATE',
                'RESIGNATION',
                'TIMEOUT',
                'STALEMATE',
                'INSUFFICIENT_MATERIAL',
                'THREEFOLD_REPETITION',
                'FIFTY_MOVE_RULE',
                'AGREEMENT',
                'ABANDONMENT',
                'JOIN_TIMEOUT',
                'SYSTEM'
            )
        ),
    CONSTRAINT "games_terminal_state_check"
        CHECK (
            (
                "status" IN ('COMPLETED', 'ABANDONED', 'EXPIRED') AND
                "result" IS NOT NULL AND
                "termination" IS NOT NULL AND
                "ended_at" IS NOT NULL
            ) OR (
                "status" NOT IN ('COMPLETED', 'ABANDONED', 'EXPIRED') AND
                "result" IS NULL AND
                "termination" IS NULL AND
                "ended_at" IS NULL
            )
        ),
    CONSTRAINT "games_turn_clock_state_check"
        CHECK (
            (
                "status" IN ('IN_PROGRESS', 'RECONNECTING') AND
                "turn_started_at" IS NOT NULL AND
                "started_at" IS NOT NULL
            ) OR (
                "status" NOT IN ('IN_PROGRESS', 'RECONNECTING') AND
                "turn_started_at" IS NULL
            )
        ),
    CONSTRAINT "games_ended_after_started_check"
        CHECK (
            "ended_at" IS NULL OR
            "started_at" IS NULL OR
            "ended_at" >= "started_at"
        )
);

CREATE UNIQUE INDEX "games_match_id_key" ON "games" ("match_id");
CREATE INDEX "games_status_join_deadline_at_idx"
    ON "games" ("status", "join_deadline_at");
CREATE INDEX "games_status_reconnect_deadline_at_idx"
    ON "games" ("status", "reconnect_deadline_at");
CREATE INDEX "games_join_deadline_due_idx"
    ON "games" ("join_deadline_at")
    WHERE "status" = 'WAITING_FOR_PLAYERS' AND "join_deadline_at" IS NOT NULL;
CREATE INDEX "games_reconnect_deadline_due_idx"
    ON "games" ("reconnect_deadline_at")
    WHERE "status" = 'RECONNECTING' AND "reconnect_deadline_at" IS NOT NULL;
CREATE INDEX "games_active_updated_at_idx"
    ON "games" ("updated_at")
    WHERE "status" IN ('CREATED', 'WAITING_FOR_PLAYERS', 'READY', 'IN_PROGRESS', 'RECONNECTING');

CREATE TABLE "game_players" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "game_id" UUID NOT NULL,
    "guest_session_id" UUID NOT NULL,
    "color" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "joined_at" TIMESTAMPTZ(3),
    "connected_at" TIMESTAMPTZ(3),
    "disconnected_at" TIMESTAMPTZ(3),
    "reconnect_grace_ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "game_players_color_check"
        CHECK ("color" IN ('w', 'b')),
    CONSTRAINT "game_players_slot_check"
        CHECK ("slot" IN (0, 1)),
    CONSTRAINT "game_players_disconnect_state_check"
        CHECK (
            ("disconnected_at" IS NULL AND "reconnect_grace_ends_at" IS NULL) OR
            (
                "disconnected_at" IS NOT NULL AND
                "reconnect_grace_ends_at" IS NOT NULL AND
                "reconnect_grace_ends_at" >= "disconnected_at"
            )
        ),
    CONSTRAINT "game_players_game_id_fkey"
        FOREIGN KEY ("game_id") REFERENCES "games" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "game_players_guest_session_id_fkey"
        FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "game_players_game_id_color_key"
    ON "game_players" ("game_id", "color");
CREATE UNIQUE INDEX "game_players_game_id_guest_session_id_key"
    ON "game_players" ("game_id", "guest_session_id");
CREATE UNIQUE INDEX "game_players_game_id_slot_key"
    ON "game_players" ("game_id", "slot");
CREATE INDEX "game_players_guest_session_id_idx"
    ON "game_players" ("guest_session_id");

CREATE TABLE "active_game_assignments" (
    "guest_session_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_game_assignments_pkey" PRIMARY KEY ("guest_session_id"),
    CONSTRAINT "active_game_assignments_guest_session_id_fkey"
        FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "active_game_assignments_game_id_fkey"
        FOREIGN KEY ("game_id") REFERENCES "games" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "active_game_assignments_game_id_idx"
    ON "active_game_assignments" ("game_id");

CREATE TABLE "moves" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "game_id" UUID NOT NULL,
    "ply" INTEGER NOT NULL,
    "client_move_id" UUID NOT NULL,
    "guest_session_id" UUID NOT NULL,
    "color" TEXT NOT NULL,
    "san" TEXT NOT NULL,
    "uci" TEXT NOT NULL,
    "fen_before" TEXT NOT NULL,
    "fen_after" TEXT NOT NULL,
    "server_received_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moves_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moves_ply_check"
        CHECK ("ply" > 0),
    CONSTRAINT "moves_color_check"
        CHECK ("color" IN ('w', 'b')),
    CONSTRAINT "moves_game_id_fkey"
        FOREIGN KEY ("game_id") REFERENCES "games" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "moves_guest_session_id_fkey"
        FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "moves_game_id_client_move_id_key"
    ON "moves" ("game_id", "client_move_id");
CREATE UNIQUE INDEX "moves_game_id_ply_key"
    ON "moves" ("game_id", "ply");
CREATE INDEX "moves_game_id_created_at_idx"
    ON "moves" ("game_id", "created_at");
CREATE INDEX "moves_guest_session_id_idx"
    ON "moves" ("guest_session_id");

CREATE TABLE "session_commands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "command_type" TEXT NOT NULL,
    "idempotency_hash" TEXT NOT NULL,
    "guest_session_id" UUID NOT NULL,
    "issued_jti" UUID,
    "issued_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_commands_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "session_commands_command_type_check"
        CHECK ("command_type" IN ('CREATE', 'RENEW', 'RESET')),
    CONSTRAINT "session_commands_issued_claims_check"
        CHECK (
            (
                "issued_jti" IS NULL AND
                "issued_at" IS NULL AND
                "expires_at" IS NULL
            ) OR (
                "issued_jti" IS NOT NULL AND
                "issued_at" IS NOT NULL AND
                "expires_at" IS NOT NULL AND
                "expires_at" > "issued_at"
            )
        ),
    CONSTRAINT "session_commands_guest_session_id_fkey"
        FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "session_commands_idempotency_hash_key"
    ON "session_commands" ("idempotency_hash");
CREATE INDEX "session_commands_guest_session_id_created_at_idx"
    ON "session_commands" ("guest_session_id", "created_at");

CREATE TABLE "game_commands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "game_id" UUID NOT NULL,
    "guest_session_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "command_type" TEXT NOT NULL,
    "result_version" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_commands_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "game_commands_command_type_check"
        CHECK ("command_type" IN (
            'JOIN',
            'MOVE',
            'RESIGN',
            'DRAW_OFFER',
            'DRAW_ACCEPT',
            'DRAW_DECLINE'
        )),
    CONSTRAINT "game_commands_result_version_check"
        CHECK ("result_version" >= 0),
    CONSTRAINT "game_commands_response_object_check"
        CHECK (jsonb_typeof("response") = 'object'),
    CONSTRAINT "game_commands_game_id_fkey"
        FOREIGN KEY ("game_id") REFERENCES "games" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "game_commands_guest_session_id_fkey"
        FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "game_commands_game_id_event_id_key"
    ON "game_commands" ("game_id", "event_id");
CREATE INDEX "game_commands_guest_session_id_created_at_idx"
    ON "game_commands" ("guest_session_id", "created_at");

-- A game allocation is an atomic aggregate: exactly two player rows and exactly
-- two matching active assignments while non-terminal, then no assignments once
-- terminal. Deferred constraint triggers allow all rows to be changed in any
-- order inside one transaction while rejecting a partial aggregate at commit.
CREATE FUNCTION "assert_game_allocation_invariants"("target_game_id" UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    game_status TEXT;
    player_count INTEGER;
    assignment_count INTEGER;
    matching_assignment_count INTEGER;
BEGIN
    SELECT "status"
    INTO game_status
    FROM "games"
    WHERE "id" = "target_game_id";

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT count(*)::INTEGER
    INTO player_count
    FROM "game_players"
    WHERE "game_id" = "target_game_id";

    IF player_count <> 2 THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                CONSTRAINT = 'games_exactly_two_players_check',
                MESSAGE = 'game allocation must contain exactly two players';
    END IF;

    SELECT
        count(*)::INTEGER,
        count(game_player."id")::INTEGER
    INTO assignment_count, matching_assignment_count
    FROM "active_game_assignments" AS assignment
    LEFT JOIN "game_players" AS game_player
        ON game_player."game_id" = assignment."game_id"
       AND game_player."guest_session_id" = assignment."guest_session_id"
    WHERE assignment."game_id" = "target_game_id";

    IF game_status IN ('COMPLETED', 'ABANDONED', 'EXPIRED') THEN
        IF assignment_count <> 0 THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = '23514',
                    CONSTRAINT = 'terminal_games_have_no_active_assignments_check',
                    MESSAGE = 'terminal games cannot have active assignments';
        END IF;
    ELSIF assignment_count <> 2 OR matching_assignment_count <> 2 THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '23514',
                CONSTRAINT = 'active_assignments_match_game_players_check',
                MESSAGE = 'non-terminal games require two matching active assignments';
    END IF;
END;
$$;

CREATE FUNCTION "check_game_allocation_from_game"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM "assert_game_allocation_invariants"(OLD."id");
    ELSE
        PERFORM "assert_game_allocation_invariants"(NEW."id");
        IF TG_OP = 'UPDATE' AND OLD."id" IS DISTINCT FROM NEW."id" THEN
            PERFORM "assert_game_allocation_invariants"(OLD."id");
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE FUNCTION "check_game_allocation_from_child"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM "assert_game_allocation_invariants"(OLD."game_id");
    ELSE
        PERFORM "assert_game_allocation_invariants"(NEW."game_id");
        IF TG_OP = 'UPDATE' AND OLD."game_id" IS DISTINCT FROM NEW."game_id" THEN
            PERFORM "assert_game_allocation_invariants"(OLD."game_id");
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "games_allocation_invariants_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "games"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "check_game_allocation_from_game"();

CREATE CONSTRAINT TRIGGER "game_players_allocation_invariants_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "game_players"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "check_game_allocation_from_child"();

CREATE CONSTRAINT TRIGGER "active_game_assignments_allocation_invariants_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "active_game_assignments"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "check_game_allocation_from_child"();

-- The local Docker bootstrap uses this conventional runtime role. Production
-- provisioning must apply the equivalent revocation to its platform-specific
-- role name. The conditional keeps isolated migration tests role-agnostic.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cluchess_runtime') THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM cluchess_runtime';
    END IF;
END;
$$;
