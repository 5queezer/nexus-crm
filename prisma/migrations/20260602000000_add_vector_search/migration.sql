-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Per-application semantic embeddings (text-embedding-3-small = 1536 dims)
CREATE TABLE IF NOT EXISTS application_embeddings (
  application_id INTEGER PRIMARY KEY REFERENCES "Application"(id) ON DELETE CASCADE,
  embedding      vector(1536) NOT NULL,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- HNSW builds incrementally and does not require pre-existing data,
-- making it safe to create on empty tables and immediately effective after backfill.
CREATE INDEX IF NOT EXISTS application_embeddings_vec_idx
  ON application_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Per-experience-entry embeddings (experience is stored as JSON in CvProfile)
CREATE TABLE IF NOT EXISTS cv_experience_embeddings (
  id            SERIAL       PRIMARY KEY,
  user_id       TEXT         NOT NULL,
  experience_id TEXT         NOT NULL,
  embedding     vector(1536) NOT NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, experience_id)
);

CREATE INDEX IF NOT EXISTS cv_experience_embeddings_vec_idx
  ON cv_experience_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
