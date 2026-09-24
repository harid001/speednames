# Quiz Night (lab)
A reusable, host-led trivia board with 5 categories and 25 questions. Start at the home page, choose a title, 2–8 team names, a host password (8–128 characters), a question JSON pack, and optional shot-question count (default 4). Keep the resulting game link and password.

Players use the game link or enter its 16-character code on the home page. Player views are read-only and refresh automatically. The host signs in from the same game page. Answers are spoken and judged in person. The host screen can be cast to the audience. Answers start collapsed under Reveal answer. Keep them hidden while teams can still steal; scoring a correct answer or finishing the question reveals the answer.

## Rules
- Teams select in a fixed rotation. Correct answers earn the question value; ordinary misses cost nothing.
- After an ordinary miss, the host chooses one other team for a single steal attempt, or reveals the answer if nobody tries.
- Exactly two questions are marked special in the JSON. On selection, the host records normal or double stakes before the question appears. Double stakes award/deduct twice the question value. Normal stakes have no penalty. Specials have no steals.
- Shot prompts are randomly assigned once per game, excluding specials. Prompts appear before the question and do not affect scores. Participation is optional.
- Undo restores the previous game step, including scores and turn. Concurrent host actions are version checked.
- After all 25 questions, the game announces winners, including ties.

## Question packs
Edit trivia/questions.json or download a copy from the setup page. Upload a replacement at game creation. Each of five objects has name and five clues. Each clue has question, answer, positive integer points (up to 10,000), and boolean special. Exactly two clues must have special=true. Each game stores its own copy, so later edits to the template do not alter games already running.

The sample pack is for Rahul’s party; the app itself accepts any event title and question content. The Wildcard category is filler to replace later.

## Storage and authentication
Uses a separate SQLite trivia.db with trivia_games and trivia_sessions tables. Game snapshots include scores, turn, clues, hidden shot selections, and undo history.
Location: TRIVIA_DATA_DIR if set, otherwise the directory of DB_PATH, otherwise ./data. The lab unit supplies DB_PATH in /var/lib/speednames-lab, so trivia.db lives there alongside (but independently of) the existing Speednames database.
Passwords use scrypt with individual random salts. Session tokens are random, hashed in the database, expire after seven days, and use HttpOnly/SameSite cookies with Secure over HTTPS. Create/login endpoints have an IP rate limit. There is no password-reset flow; keep the host password.
Player APIs expose only the current question, revealed answers, category names, points, and scores. Future questions, specials, shot selections, and host answers are excluded. The starter template is public sample content; private packs are available only through the authenticated host API.

## Development
npm ci
node --test trivia/test.js
PORT=3000 node server.js

The old Speednames assets and db.js remain for lab recovery and compatibility with the lab verification skill; server.js now starts Quiz Night. This branch must not be merged into production.
Deploy through /home/linuxuser/.codex/skills/speednames-lab/scripts/verify.sh and the existing speednames-lab-deploy wrapper after commit and push. No host configuration changes are required.

## Photos and videos
Add an optional media object to any clue in the JSON pack:

```json
{
  "question": "Where was this photo taken?",
  "answer": "Your answer",
  "points": 200,
  "special": false,
  "media": {
    "type": "image",
    "url": "https://your-media-host.example/photo.jpg",
    "alt": "A photo of the location"
  }
}
```

Use type "video" with a direct HTTPS video-file URL (MP4 is a good choice; support depends on the browser and video encoding). Photos can use browser-supported formats such as JPEG, PNG, WebP, or GIF. "alt" is optional descriptive text; avoid putting the answer in it.

Media links must be accessible to players without signing in. YouTube pages, Google Drive preview links, and other webpage URLs are not direct media files. This version links to hosted media; it does not upload local photo/video files.

Media appears only once the question opens, after the shot prompt or stakes selection. Videos have normal play/pause, seeking, volume and fullscreen controls; playback is manual and independent on each device. Casting the host phone shows that phone's playback. Broken media shows an open-link fallback without blocking the question.

New packs are applied when creating a game; existing games keep their original questions.

## Joining by QR code
Open Options → Show QR code to display a large code for the audience to scan. It links directly to the read-only player view without host credentials. Copy link provides the same player URL. Even a browser with an existing host session enters player view through this link; Host sign in restores controls after password verification.
