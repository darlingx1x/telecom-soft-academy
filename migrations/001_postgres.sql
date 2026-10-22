CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
  department TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_aliases(
  username TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS courses(
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  level TEXT NOT NULL,
  duration INTEGER NOT NULL,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  tagline TEXT NOT NULL,
  skills TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS lessons(
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  body TEXT NOT NULL,
  UNIQUE(course_id,position)
);
CREATE TABLE IF NOT EXISTS questions(
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  correct INTEGER NOT NULL,
  explanation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enrollments(
  user_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,course_id)
);
CREATE TABLE IF NOT EXISTS completions(
  user_id INTEGER NOT NULL REFERENCES users(id),
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,lesson_id)
);
CREATE TABLE IF NOT EXISTS attempts(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  score INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lesson_notes(
  user_id INTEGER NOT NULL REFERENCES users(id),
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,lesson_id)
);
CREATE TABLE IF NOT EXISTS submissions(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','submitted','reviewed')),
  score INTEGER,
  feedback TEXT NOT NULL DEFAULT '',
  reviewer_id INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMPTZ,
  UNIQUE(user_id,lesson_id)
);
CREATE TABLE IF NOT EXISTS bookmarks(
  user_id INTEGER NOT NULL REFERENCES users(id),
  article_id TEXT NOT NULL,
  PRIMARY KEY(user_id,article_id)
);
CREATE TABLE IF NOT EXISTS notification_reads(
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_key TEXT NOT NULL,
  PRIMARY KEY(user_id,item_key)
);
CREATE INDEX IF NOT EXISTS attempts_user_course ON attempts(user_id,course_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE INDEX IF NOT EXISTS submissions_status ON submissions(status,updated_at);
