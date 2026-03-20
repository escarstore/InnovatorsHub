-- ================================================================
--  InnovatorsHub Uganda — Supabase Database Schema
--  Paste this in: Supabase → SQL Editor → New Query → Run
-- ================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── PROFILES (extends Supabase auth.users) ───────────────────
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL DEFAULT '',
  email           TEXT,
  headline        TEXT DEFAULT '',
  bio             TEXT DEFAULT '',
  avatar_url      TEXT DEFAULT NULL,
  avatar_color    TEXT DEFAULT '#6366f1',
  location        TEXT DEFAULT '',
  sector          TEXT DEFAULT '',
  social_links    JSONB DEFAULT '{}',
  is_admin        BOOLEAN DEFAULT FALSE,
  is_verified     BOOLEAN DEFAULT FALSE,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  subscription_status TEXT DEFAULT 'free' CHECK (subscription_status IN ('free','active','expired')),
  subscription_expires_at TIMESTAMPTZ DEFAULT NULL,
  points          INTEGER DEFAULT 0,
  ref_code        TEXT UNIQUE,
  referred_by     TEXT DEFAULT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, ref_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url',
    UPPER(SUBSTRING(REPLACE(split_part(NEW.email, '@', 1), '.', ''), 1, 6)) || FLOOR(RANDOM()*9000+1000)::TEXT
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── POSTS ────────────────────────────────────────────────────
CREATE TABLE posts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  type            TEXT DEFAULT 'text' CHECK (type IN ('text','image','video','resource','poll')),
  media_url       TEXT DEFAULT NULL,
  media_name      TEXT DEFAULT NULL,
  yt_url          TEXT DEFAULT NULL,
  yt_thumbnail    TEXT DEFAULT NULL,
  poll_data       JSONB DEFAULT NULL,
  is_flagged      BOOLEAN DEFAULT FALSE,
  is_deleted      BOOLEAN DEFAULT FALSE,
  likes_count     INTEGER DEFAULT 0,
  comments_count  INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_posts_user_id   ON posts(user_id);
CREATE INDEX idx_posts_created   ON posts(created_at DESC);
CREATE INDEX idx_posts_flagged   ON posts(is_flagged) WHERE is_flagged = TRUE;
CREATE INDEX idx_posts_body_fts  ON posts USING GIN (to_tsvector('english', body));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_posts_updated BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── POST REACTIONS ────────────────────────────────────────────
CREATE TABLE post_reactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction_type   TEXT NOT NULL CHECK (reaction_type IN ('like','insightful','fire','collab')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id, reaction_type)
);

CREATE INDEX idx_reactions_post ON post_reactions(post_id);
CREATE INDEX idx_reactions_user ON post_reactions(user_id);

-- Auto update likes_count on posts
CREATE OR REPLACE FUNCTION sync_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.reaction_type = 'like' THEN
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' AND OLD.reaction_type = 'like' THEN
    UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_likes AFTER INSERT OR DELETE ON post_reactions
  FOR EACH ROW EXECUTE FUNCTION sync_likes_count();

-- ── COMMENTS ─────────────────────────────────────────────────
CREATE TABLE comments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id);

-- Auto update comments_count
CREATE OR REPLACE FUNCTION sync_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_comments AFTER INSERT OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION sync_comments_count();

-- ── FOLLOWS ──────────────────────────────────────────────────
CREATE TABLE follows (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK(follower_id != following_id)
);

CREATE INDEX idx_follows_follower  ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);

-- ── MESSAGES ─────────────────────────────────────────────────
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  is_read         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_sender   ON messages(sender_id);
CREATE INDEX idx_messages_receiver ON messages(receiver_id);

-- ── THREADS (Discussions) ─────────────────────────────────────
CREATE TABLE threads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'General',
  replies_count   INTEGER DEFAULT 0,
  views_count     INTEGER DEFAULT 0,
  is_pinned       BOOLEAN DEFAULT FALSE,
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_threads_category ON threads(category);
CREATE INDEX idx_threads_created  ON threads(created_at DESC);

CREATE TABLE thread_replies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id       UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_thread_replies ON thread_replies(thread_id);

-- ── RESOURCES ────────────────────────────────────────────────
CREATE TABLE resources (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  file_url        TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_type       TEXT NOT NULL CHECK (file_type IN ('pdf','video','zip','doc','image','other')),
  file_size_mb    DECIMAL(8,2) DEFAULT 0,
  downloads_count INTEGER DEFAULT 0,
  is_approved     BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_resources_type    ON resources(file_type);
CREATE INDEX idx_resources_created ON resources(created_at DESC);

-- ── COURSES ──────────────────────────────────────────────────
CREATE TABLE courses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by      UUID NOT NULL REFERENCES profiles(id),
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  yt_url          TEXT NOT NULL,
  yt_thumbnail    TEXT DEFAULT NULL,
  instructor      TEXT DEFAULT '',
  level           TEXT DEFAULT 'All Levels',
  duration        TEXT DEFAULT '',
  icon            TEXT DEFAULT '🎓',
  is_published    BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── EVENTS ───────────────────────────────────────────────────
CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by      UUID NOT NULL REFERENCES profiles(id),
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  event_date      TIMESTAMPTZ NOT NULL,
  location        TEXT NOT NULL,
  event_type      TEXT DEFAULT 'physical' CHECK (event_type IN ('physical','online','hybrid')),
  rsvp_count      INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE event_rsvps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

-- ── STARTUPS ─────────────────────────────────────────────────
CREATE TABLE startups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  tagline         TEXT NOT NULL,
  description     TEXT DEFAULT '',
  logo_emoji      TEXT DEFAULT '🚀',
  sector          TEXT NOT NULL,
  stage           TEXT DEFAULT 'idea',
  location        TEXT DEFAULT '',
  website         TEXT DEFAULT NULL,
  is_approved     BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  is_read         BOOLEAN DEFAULT FALSE,
  link            TEXT DEFAULT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifs_user ON notifications(user_id);

-- ── REPORTS ──────────────────────────────────────────────────
CREATE TABLE reports (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reported_post_id    UUID REFERENCES posts(id) ON DELETE CASCADE,
  report_type         TEXT NOT NULL,
  description         TEXT DEFAULT '',
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  resolved_by         UUID REFERENCES profiles(id),
  resolved_at         TIMESTAMPTZ DEFAULT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────
CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,
  currency        TEXT DEFAULT 'UGX',
  payment_method  TEXT NOT NULL,
  phone_number    TEXT NOT NULL,
  transaction_id  TEXT UNIQUE,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','refunded')),
  referral_code   TEXT DEFAULT NULL,
  discount_applied INTEGER DEFAULT 0,
  starts_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── SAVED POSTS ───────────────────────────────────────────────
CREATE TABLE saved_posts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);

-- ── OWNER ALERTS ─────────────────────────────────────────────
CREATE TABLE owner_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  icon            TEXT DEFAULT '🔔',
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  alert_type      TEXT DEFAULT 'info',
  is_read         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE startups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions  ENABLE ROW LEVEL SECURITY;

-- Profiles: readable by all, editable by owner
CREATE POLICY "profiles_read_all"    ON profiles FOR SELECT USING (status != 'deleted');
CREATE POLICY "profiles_update_own"  ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own"  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Posts: read all non-deleted, insert/delete own
CREATE POLICY "posts_read"    ON posts FOR SELECT USING (is_deleted = FALSE AND is_flagged = FALSE);
CREATE POLICY "posts_insert"  ON posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "posts_update"  ON posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "posts_delete"  ON posts FOR DELETE USING (auth.uid() = user_id);

-- Comments
CREATE POLICY "comments_read"   ON comments FOR SELECT USING (is_deleted = FALSE);
CREATE POLICY "comments_insert" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Reactions
CREATE POLICY "reactions_read"   ON post_reactions FOR SELECT USING (TRUE);
CREATE POLICY "reactions_insert" ON post_reactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reactions_delete" ON post_reactions FOR DELETE USING (auth.uid() = user_id);

-- Follows
CREATE POLICY "follows_read"   ON follows FOR SELECT USING (TRUE);
CREATE POLICY "follows_insert" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows_delete" ON follows FOR DELETE USING (auth.uid() = follower_id);

-- Messages: private
CREATE POLICY "messages_read"   ON messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "messages_update" ON messages FOR UPDATE USING (auth.uid() = receiver_id);

-- Threads
CREATE POLICY "threads_read"   ON threads FOR SELECT USING (is_deleted = FALSE);
CREATE POLICY "threads_insert" ON threads FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Thread replies
CREATE POLICY "replies_read"   ON thread_replies FOR SELECT USING (is_deleted = FALSE);
CREATE POLICY "replies_insert" ON thread_replies FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Resources
CREATE POLICY "resources_read"   ON resources FOR SELECT USING (is_approved = TRUE);
CREATE POLICY "resources_insert" ON resources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "resources_update" ON resources FOR UPDATE USING (auth.uid() = user_id);

-- Courses: read all
CREATE POLICY "courses_read"   ON courses FOR SELECT USING (is_published = TRUE);
CREATE POLICY "courses_insert" ON courses FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT id FROM profiles WHERE is_admin = TRUE)
);

-- Events
CREATE POLICY "events_read"   ON events FOR SELECT USING (is_active = TRUE);
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT id FROM profiles WHERE is_admin = TRUE)
);

-- Event RSVPs
CREATE POLICY "rsvps_read"   ON event_rsvps FOR SELECT USING (TRUE);
CREATE POLICY "rsvps_insert" ON event_rsvps FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "rsvps_delete" ON event_rsvps FOR DELETE USING (auth.uid() = user_id);

-- Startups
CREATE POLICY "startups_read"   ON startups FOR SELECT USING (is_approved = TRUE);
CREATE POLICY "startups_insert" ON startups FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Notifications: own only
CREATE POLICY "notifs_read"   ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifs_update" ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifs_insert" ON notifications FOR INSERT WITH CHECK (TRUE);

-- Reports
CREATE POLICY "reports_insert" ON reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "reports_read"   ON reports FOR SELECT USING (auth.uid() = reporter_id);

-- Saved posts: own only
CREATE POLICY "saved_read"   ON saved_posts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "saved_insert" ON saved_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_delete" ON saved_posts FOR DELETE USING (auth.uid() = user_id);

-- Subscriptions: own only
CREATE POLICY "subs_read"   ON subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subs_insert" ON subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── STORAGE BUCKETS ────────────────────────────────────────────
-- Run these in Supabase Storage section, or via SQL:
INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('resources', 'resources', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT DO NOTHING;

CREATE POLICY "uploads_read"   ON storage.objects FOR SELECT USING (bucket_id IN ('uploads','resources','avatars'));
CREATE POLICY "uploads_insert" ON storage.objects FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND bucket_id IN ('uploads','resources','avatars'));
CREATE POLICY "uploads_delete" ON storage.objects FOR DELETE USING (auth.uid()::text = (storage.foldername(name))[1]);

-- ── SET YOUR ADMIN ACCOUNT ─────────────────────────────────────
-- After signing up with alexander@innovatorshub.ug, run this:
-- UPDATE profiles SET is_admin = TRUE WHERE email = 'alexander@innovatorshub.ug';

-- ── ADMIN RLS PATCHES ─────────────────────────────────────────
-- Admins can read ALL reports
CREATE POLICY "reports_read_admin" ON reports FOR SELECT
  USING (auth.uid() IN (SELECT id FROM profiles WHERE is_admin = TRUE));

-- Admins can update/delete any post
CREATE POLICY "posts_update_admin" ON posts FOR UPDATE
  USING (auth.uid() IN (SELECT id FROM profiles WHERE is_admin = TRUE));

-- Admins can update any profile (suspend, reinstate)
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  USING (auth.uid() IN (SELECT id FROM profiles WHERE is_admin = TRUE));

-- Admins can approve startups
CREATE POLICY "startups_update_admin" ON startups FOR UPDATE
  USING (auth.uid() IN (SELECT id FROM profiles WHERE is_admin = TRUE));

-- Admins can approve resources
CREATE POLICY "resources_update_admin" ON resources FOR UPDATE
  USING (auth.uid() IN (SELECT id FROM profiles WHERE is_admin = TRUE));
