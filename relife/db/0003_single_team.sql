-- Consolidates all legacy teams into one "Tim IT" (Head IT = usr-lead, members = every agent).
-- Guarded with EXISTS (SELECT 1 FROM users) so fresh empty databases still run full demo seeding first.
-- Historical ticket_events payloads (fromTeamId/toTeamId) are left untouched (append-only log).

-- Bayu Santoso was the second lead; with one team he becomes a regular member.
UPDATE users SET role = 'agent'
WHERE id = 'usr-lead2' AND role = 'lead';

INSERT INTO teams (id, ord, name, description, lead_id, auto_assign, created_at)
SELECT
  'team-it',
  0,
  'Tim IT',
  'Tim IT CTII: Head IT dan anggota.',
  CASE
    WHEN EXISTS (SELECT 1 FROM users WHERE id = 'usr-lead') THEN 'usr-lead'
    ELSE (SELECT id FROM users WHERE role = 'lead' ORDER BY id LIMIT 1)
  END,
  0,
  COALESCE((SELECT MIN(created_at) FROM teams), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE EXISTS (SELECT 1 FROM users)
ON CONFLICT (id) DO NOTHING;

UPDATE tickets SET team_id = 'team-it'
WHERE EXISTS (SELECT 1 FROM teams WHERE id = 'team-it')
  AND (team_id IS NULL OR team_id <> 'team-it');

UPDATE categories SET default_team_id = 'team-it'
WHERE EXISTS (SELECT 1 FROM teams WHERE id = 'team-it')
  AND (default_team_id IS NULL OR default_team_id <> 'team-it');

-- Rebuild memberships: every active-or-not lead/agent except the Head.
DELETE FROM team_members;

INSERT INTO team_members (team_id, user_id, ord)
SELECT 'team-it', u.id, ROW_NUMBER() OVER (ORDER BY u.created_at, u.id) - 1
FROM users u
WHERE EXISTS (SELECT 1 FROM teams WHERE id = 'team-it')
  AND u.role IN ('agent', 'lead')
  AND u.id IS NOT (SELECT lead_id FROM teams WHERE id = 'team-it');

DELETE FROM teams
WHERE id <> 'team-it'
  AND EXISTS (SELECT 1 FROM teams WHERE id = 'team-it');
