/*
  # Create Projects Table

  1. New Tables
    - `projects`
      - `id` (uuid, primary key) - Unique identifier for each project
      - `user_id` (uuid, foreign key) - References auth.users
      - `name` (text) - Project name
      - `bpm` (integer) - Beats per minute, default 120
      - `created_at` (timestamptz) - Timestamp when project was created
      - `updated_at` (timestamptz) - Timestamp when project was last modified
      - `data` (jsonb) - Stores project configuration and track data

  2. Security
    - Enable RLS on `projects` table
    - Add policy for users to view their own projects
    - Add policy for users to create their own projects
    - Add policy for users to update their own projects
    - Add policy for users to delete their own projects
*/

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL DEFAULT 'Untitled Project',
  bpm integer DEFAULT 120,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  data jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects"
  ON projects FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
  ON projects FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);