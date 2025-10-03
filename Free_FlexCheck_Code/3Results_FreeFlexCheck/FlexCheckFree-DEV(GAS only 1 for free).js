/* ---------------- CONFIG ---------------- */
const TRACKER_ID = '1h66WWESaFjq7s8ZTDFPTkORufEDVO8iQhSDLe0RaCYs';
const TRACK_TAB  = 'Codename Tracker';

const SNAP_ID    = '1zne4Lfb6Lgp13BryrSaXnRFBSox84Ysxc9ut_MR7biY';
const SNAP_TAB   = 'Submissions';

const SITE_URL   = 'https://www.gameplanfitness.com/flexcheck-freeresults/?ticket=';
const OPENAI_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_KEY');

const CACHE_TTL  = 15 * 60;          // seconds

/* ------------- helper : JSON out ------------- */
function out_(o){
  return ContentService
         .createTextOutput(JSON.stringify(o))
         .setMimeType(ContentService.MimeType.JSON)
}
function error_(m){ return out_({error:m}); }


/* ---------- ticket checker (read-only) ---------- */
/* ---------- ticket checker (read-only) ---------- */
function checkTicket_(ticket, email){
  const sh = SpreadsheetApp.openById(TRACKER_ID).getSheetByName(TRACK_TAB);

  /* fixed column map */
  const COL_EMAIL   = 2;   // B
  const COL_TICKET  = 3;   // C
  const COL_REDEEM  = 6;   // F
  const COL_PAID    = 7;   // G
  const FIRST_ROW   = 2;   // HEADER row is 1 → data start row 2

  /* pull A–G for all data rows */
  const rows = sh.getRange(FIRST_ROW, 1,
                           sh.getLastRow() - FIRST_ROW + 1,
                           COL_PAID)
                 .getValues();

  const idx = rows.findIndex(r =>
      String(r[COL_TICKET-1]).trim() === ticket);

  if (idx === -1)                 return {ok:false,error:'invalid_ticket'};

  const row = rows[idx];

  if (String(row[COL_EMAIL-1]).toLowerCase().trim() !== email)
        return {ok:false,error:'email_mismatch'};

  /* -------- boolean-safe checks -------- */
  const redeemed = row[COL_REDEEM-1] === true ||
                   String(row[COL_REDEEM-1]).toUpperCase() === 'TRUE';
  if (redeemed)  return {ok:false,error:'already_redeemed'};

  const paid     = row[COL_PAID-1] === true ||
                   String(row[COL_PAID-1]).toUpperCase() === 'TRUE';
  if (paid)      return {ok:false,error:'ticket_paid'};

  return {ok:true, sheetRow:FIRST_ROW+idx, colRedeem:COL_REDEEM};
}



/* -------------------- GET -------------------- */
/* -------------------- GET -------------------- */
function doGet(e){

  /* 1️⃣  validator:  /exec?ticket=…&email=…  */
  if (e.parameter.ticket && e.parameter.email){
    return out_( checkTicket_(
        String(e.parameter.ticket).trim(),
        String(e.parameter.email ).toLowerCase().trim()
      ));
  }

  /* 2️⃣  result fetch:  /exec?ticket=…  */
  if (e.parameter.ticket){
    const t  = String(e.parameter.ticket).trim();
    const sh = SpreadsheetApp.openById(SNAP_ID).getSheetByName(SNAP_TAB);

    if (sh.getLastRow() < 2) return out_({pending:true});

const hit = sh.getRange(2,1, sh.getLastRow()-1, 5)   // A-E only
             .getValues()
             .find(r => r[0] == t);

const raw = hit ? hit[4] : null;                     // index 4 → column E
return out_( raw ? JSON.parse(raw) : {pending:true} );
  }

  /* 3️⃣  otherwise → bad request */
  return out_({error:'missing_params'});
}


/* -------------------- POST  (webhook) -------------------- */
function doPost(e){
  const data   = JSON.parse(e.postData.contents || '{}');
  const ticket = String((data.ticket || '').trim());
  const email  = (data.email  || '').toLowerCase().trim();
  const photo  = Array.isArray(data.photoUrl) ? data.photoUrl[0] : data.photoUrl;

  if (!ticket || !email || !photo) return error_('missing_fields');

  const v = checkTicket_(ticket,email);
  if (!v.ok) return error_(v.error);

  /* mark SnapRedeemed? */
  SpreadsheetApp.openById(TRACKER_ID)
    .getSheetByName(TRACK_TAB)
    .getRange(v.sheetRow, v.colRedeem).setValue('TRUE');

  /* dup-guard */
  const cache = CacheService.getScriptCache();
  if (cache.get(ticket)) return error_('dup_within_15m');
  cache.put(ticket,'1',CACHE_TTL);

  /* ensure Submissions header */
  const ss = SpreadsheetApp.openById(SNAP_ID).getSheetByName(SNAP_TAB);
  if (ss.getLastRow() === 0){
  ss.appendRow([
    'Ticket',            // A
    'entryId',           // B
    'email',             // C
    'photoUrl',          // D
    'resultJson',        // E
    'isPaid',            // F
    'createdAt'          // G
  ]);
}

  /* upsert row */
let rowIdx;
const hit = ss.getRange(2,1, ss.getLastRow()-1, 1)
              .getValues()
              .findIndex(r => r[0] == ticket);

if (hit === -1){
  ss.appendRow([
    ticket,
    data.entryId || '',
    email,
    photo,          // D
    '',             // E  (resultJson placeholder)
    'FALSE',        // F  isPaid
    new Date()      // G
  ]);
  rowIdx = ss.getLastRow();
}else{
  rowIdx = hit + 2;            // (+2 for header)
}
  /* GPT */
  let json;
  try{ json = callGPT_(photo); }
  catch(err){ json = {pending:true,error:'openai_failed'}; }

ss.getRange(rowIdx, 5).setValue(JSON.stringify(json));   // column E = resultJson
sendLinkFromSheet(ticket);
  return out_({ok:true});
}

/* ---------------- GPT wrapper ---------------- */
function callGPT_(url){
  const PROMPT =
`You are a high-level, critically objective **physique-judging expert**.  
You **must** return **exactly one** JSON object matching this schema (no extra keys, no omissions):

{
  "score": int,               // Overall snap-score 1–100
  "muscleRatings": {
    "Chest": int,             // 0–100 (upper + lower pecs)
    "Shoulders": int,         // 0–100 (all three deltoid heads)
    "Midsection": int,        // 0–100 (abs + obliques + serratus)
    "Arms": int,              // 0–100 (biceps + triceps + forearms)
    "Back": int,              // 0–100 (lats + traps + teres major + infraspinatus + erector spinae)
    "Legs": int               // 0–100 (quads + hamstrings + calves)
  },
  "summary": str              // ~40 words, balanced strengths & weaknesses
}

**1) POSE ANALYSIS & VISIBILITY**  
• Identify the pose (e.g. “front relaxed,” “side chest”).  
• For each muscle group, mark it **Visible** (any skin/contour) or **Not Visible** (out of frame or fully obscured).  

**2) VISIBILITY RULES**  
• **Visible →** rate 1–100 using your rubric.  
• **Not Visible →** omit from averaging (use 0 only internally, but do not punish).  

**3) MUSCLE GROUP DEFINITIONS**  
- **Chest:** upper + lower pectoralis  
- **Shoulders:** anterior, lateral, posterior deltoids  
- **Midsection:** rectus abdominis, obliques, serratus anterior  
- **Arms:** biceps, triceps, forearms  
- **Back:** latissimus dorsi, trapezius, teres major, infraspinatus, erector spinae  
- **Legs:** quadriceps, hamstrings, calves  

**4) INTERNAL RUBRIC** _(for your reasoning only)_  
Evaluate each visible group on these seven axes:  
  1. **Proportions** — size relative to adjacent muscles  
  2. **Lean Mass** — cross-sectional thickness  
  3. **Detail** — separation, striations, vascularity  
  4. **Roundness** — 3D fullness of the muscle belly  
  5. **Insertions** — muscle-belly length vs. joint width  
  6. **Balance** — development across distant groups (e.g. arms vs. calves)  
  7. **Symmetry** — left vs. right matching  

**5) RAW MUSCLE RATINGS**  
Assign each **visible** muscle group an integer **1–100**. Do not assign 0 unless truly invisible.  

**6) DETAILED SCORING CURVE**  
Only truly exceptional physiques in a commercial gym should exceed the 60–69 band. Use these criteria to justify a rating in each range:

- **95–100 (Olympia-Caliber):** flawless proportions, 3D roundness, razor-sharp detail, textbook insertions, perfectly balanced & symmetrical.  
- **90–94 (Pro-Level Contender):** world-class conditioning & fullness, minor imperfections only.  
- **80–89 (National Amateur/Pro Qualifier):** superior size & conditioning across ≥5 muscle groups, clear separation & roundness; any weak point is small.  
- **70–79 (Local Show-Ready):** show-ready in ≥4 groups, good detail & shape, but minor gaps in fullness or separation.  
- **60–69 (Competitive Amateur):** noticeable development & leanness in ≥3 groups, visible striations in at least one area, but lacks overall polish.  
- **50–59 (Very Fit Amateur):** solid muscle & lean mass in ≥2 groups, limited separation/roundness; above-average but not contest-ready.  
- **40–49 (Slightly Underdeveloped):** some muscle definition, general fit appearance, but visible soft areas and poor separation.  
- **30–39 (Beginner Progress):** early signs of muscle growth, minimal definition, still building basic mass.  
- **0–29 (Untrained):** negligible muscle development, no visible definition.  

7) BAND ASSIGNMENT & FINAL SCORE

a) Evaluate from top (most elite) down.
-Elite Bands
  95–100 (Olympia): ≥5 groups ≥90 → base 97; ≥4 groups ≥90 → base 95
  90–94 (Pro): ≥5 groups ≥85 → base 92; ≥4 groups ≥85 → base 90
  80–89 (National Qualifier): ≥4 groups ≥80 → base 85; ≥3 groups ≥80 → base 80

-Core Bands
70–79 (Show-Ready): ≥3 groups ≥70 → base 75
60–69 (Competitive Amateur): ≥3 groups ≥60 → base 65
50–59 (Very Fit): ≥3 groups ≥50 → base 55
≤49 (Novice): otherwise → base 45

b) Adjustments (±4 max)
+2 if conditioning/detail is exceptional
+2 if proportions & symmetry are exemplary
–2 if any visible group <50

c)Final Score
final_score = clamp(base + adjustments, 1, 100)

**8) SUMMARY**  
In ~40 words, state:  
  - Core strengths (e.g. “chest full, abs crisply separated”)  
  - Primary weaknesses (e.g. “shoulders lack roundness,” “back not visible”)  
  - No actionable advice—just balanced observations.  

Using this picture: ${url}`;   //  ← ADD the url variable

  const payload = {
    model:'gpt-4o-mini',
    temperature:0.2,
    response_format:{type:'json_object'},
    messages:[{role:'user',content:[
      {type:'text',text:PROMPT},
      {type:'image_url',image_url:{url}}
    ]}]
  };

  const r = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions',{
    method : 'post',
    contentType : 'application/json',
    headers:{Authorization:`Bearer ${OPENAI_KEY}`},
    payload:JSON.stringify(payload),
    timeout:30000
  });
  const o = JSON.parse(r.getContentText()||'{}');
  if (!o.choices?.length) throw new Error('openai_empty');
  return JSON.parse(o.choices[0].message.content);
}

/* ---------------- Helpers ---------------- */
function sendLinkFromSheet(ticket) {
  const sh = SpreadsheetApp.openById(SNAP_ID).getSheetByName(SNAP_TAB);
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues(); // A-C: ticket, entryId, email

  const row = data.find(r => String(r[0]).trim() === ticket);
  if (!row) throw new Error(`Ticket ${ticket} not found in Submissions sheet.`);

  const recipientEmail = String(row[2]).trim(); // Column C

  if (!recipientEmail || !recipientEmail.includes('@')) {
    throw new Error(`Invalid email for ticket ${ticket}: "${recipientEmail}"`);
  }

  const link = `${SITE_URL}${ticket}`;
  const subject = `Your FlexCheck Results (Ticket #${ticket})`;
  const plainBody = `View your FlexCheck results here: ${link}`;
  const htmlBody = `
    <p>Thanks for submitting your Free FlexCheck!</p>
    <p>Your personalized results are now live here:</p>
    <p><a href="${link}">${link}</a></p>
    `;

  Logger.log(`Sending to: ${recipientEmail}`);
  GmailApp.sendEmail(recipientEmail, subject, plainBody, { htmlBody });

  Logger.log(`✅ Email sent to ${recipientEmail} for ticket ${ticket}`);
}

/* ---------------- Test email ---------------- */

function testSendEmailFromSheet(){
  sendLinkFromSheet("1775");  // Replace with an actual ticket
}