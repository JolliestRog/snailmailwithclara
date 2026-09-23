INSERT INTO member_messages (id, user_id, kind, title, body)
SELECT
  'welcome-existing-' || id,
  id,
  'welcome',
  'Welcome — start here',
  'Welcome to the live beta. Start in Address vault: enter the mailing label you want approved senders to use, then choose Encrypt and save address. The server receives encrypted address data, not the readable label.' || char(10) || char(10) ||
  'Keep your recovery code somewhere private. It unlocks your encrypted vault on a new browser; moderators cannot retrieve it for you. In Settings, choose whether to join roulette and whether you want email alerts or Clara''s newsletters.' || char(10) || char(10) ||
  'People can request to mail you from the People page. Nothing shares your address until you approve a request. Use Inbox to review requests and mailing labels.' ||
  CASE WHEN roles_json LIKE '%"moderator"%' THEN
    char(10) || char(10) || 'Moderator tools: Moderation shows pending members, reports, recovery links, and invitation batches. Verify people outside the app before approval. Never ask for an address or recovery code. Moderator invitations do not grant security administrator access.'
  ELSE '' END ||
  CASE WHEN roles_json LIKE '%"curator"%' THEN
    char(10) || char(10) || 'Curator tools: Clara''s page lets you edit a draft, preview it, publish it, and roll back revisions. Updates lets you compose newsletters for members who explicitly opted in.'
  ELSE '' END
FROM users
WHERE status = 'active';
