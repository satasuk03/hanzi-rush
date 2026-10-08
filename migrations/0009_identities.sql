-- 0009_identities.sql: sign-in with Google / Apple / Play Games (POST /auth/:provider, docs/backend.md §2).
-- At most one linked account per provider per player, so "signed in with Google" always names one Google account.
CREATE UNIQUE INDEX identities_player_provider ON identities(player_id, provider);
