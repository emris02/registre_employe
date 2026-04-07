-- Add default admin users
-- Super Admin: ouologuemoussa@gmail.com / admin123
INSERT INTO "admins" ("email", "mot_de_passe", "nom", "prenom", "role", "actif", "created_at", "updated_at")
VALUES (
  'ouologuemoussa@gmail.com',
  '$2b$12$2BU1gExh9.uioDYEcoDk1OL5gJDNsGTZGqRYQOLPdexasg29VH5su',
  'Ouologuem',
  'Moussa',
  'super_admin',
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("email") DO UPDATE SET
  "mot_de_passe" = EXCLUDED."mot_de_passe",
  "role" = EXCLUDED."role",
  "actif" = true,
  "updated_at" = NOW();

-- Admin: xpertproformation@gmail.com / admin123
INSERT INTO "admins" ("email", "mot_de_passe", "nom", "prenom", "role", "actif", "created_at", "updated_at")
VALUES (
  'xpertproformation@gmail.com',
  '$2b$12$2BU1gExh9.uioDYEcoDk1OL5gJDNsGTZGqRYQOLPdexasg29VH5su',
  'Xpert',
  'Pro',
  'admin',
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("email") DO UPDATE SET
  "mot_de_passe" = EXCLUDED."mot_de_passe",
  "role" = EXCLUDED."role",
  "actif" = true,
  "updated_at" = NOW();
