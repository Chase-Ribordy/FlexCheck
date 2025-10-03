/****  ─────────────────────────────────────────────────────────────
 *   FLEXCHECK – Enhanced Parallel Processing System
 *   - Receives form webhook POST
 *   - Parallel: Write to Submissions + Direct GPT call
 *   - Process completed entries to Processed tab
 *  ─────────────────────────────────────────────────────────────  ****/

// ========== CONFIGURATION ==========
const CFG = {
  SPREADSHEET_ID: '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0',
  SUBMISSIONS_TAB: 'Submissions',
  PROCESSED_TAB: 'Processed',
  TIMEZONE: Session.getScriptTimeZone() || 'America/Chicago',
  CACHE_TTL: 15 * 60 // 15 minutes in seconds
};

const SUBMISSIONS_HEADERS = [
  'timestampISO', 'email', 'entryId', 'ticket', 'isPaid',
  'heightCm', 'heightIn', 'weightKg', 'weightLb', 'trainingAgeYears',
  'socialHandle', 'photoUrls', 'resultJson', 'createdAtISO', 'age'
];

const PROCESSED_HEADERS = [
  'entryId', 'ticket', 'email', 'isPaid', 'createdAtISO', 'cachedAt', 'weekKey',
  'score', 'summary', 'divisionFit', 'muscleRatings', 'age',
  'heightCm', 'heightIn', 'weightKg', 'weightLb', 'trainingAgeYears',
  'socialHandle', 'photos', 'bestExercises', 'biomechanics'
];

const AI = {
  MODEL: 'gpt-4o-mini',
  ENDPOINT: 'https://api.openai.com/v1/chat/completions',
  API_KEY: PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || ''
};

// ========== MAIN WEBHOOK ENTRY POINT ==========
function doPost(e) {
  try {
    const payload = readJsonBody_(e);
    
    // Validate required fields
    const entryId = String((payload.entryId || payload.EntryId || '').trim());
    const email = (payload.email || '').toLowerCase().trim();
    
    if (!entryId || !email) {
      return jsonOut_({ ok: false, error: 'Missing required fields: entryId, email' });
    }

    // ========== DEDUPE PROTECTION ==========
    // 1. Cache check (15 min duplicate prevention)
    const cache = CacheService.getScriptCache();
    if (cache.get(entryId)) {
      return jsonOut_({ ok: false, error: 'duplicate_15m', entryId });
    }
    cache.put(entryId, '1', CFG.CACHE_TTL);

    // 2. Lock to prevent concurrent processing
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return jsonOut_({ ok: false, error: 'lock_busy' });
    }

    try {
      // 3. Properties check (permanent duplicate prevention)
      const props = PropertiesService.getScriptProperties();
      if (props.getProperty(`processed_${entryId}`)) {
        return jsonOut_({ ok: false, error: 'already_processed', entryId });
      }

      // 4. Sheet check (final duplicate prevention)
      const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
      const shSub = ss.getSheetByName(CFG.SUBMISSIONS_TAB);
      const existingEntry = checkExistingEntry_(shSub, entryId);
      
      if (existingEntry.exists) {
        return jsonOut_({ 
          ok: false, 
          error: 'already_exists_in_sheet', 
          entryId,
          existingData: existingEntry.data 
        });
      }

      // Parallel processing: Submissions write + GPT call
      const submissionRow = writeToSubmissions_(payload);
      const gptResult = callGPTDirectly_(payload);
      
      // Update submission with GPT result
      updateSubmissionWithGPT_(entryId, gptResult);
      
      // Process completed entry to Processed tab
      processCompletedEntries_();
      
      // Send confirmation email with player card link
      sendConfirmationEmail_(payload.email, entryId);
      
      // Mark as processed in properties
      props.setProperty(`processed_${entryId}`, new Date().toISOString());
      
      return jsonOut_({ 
        ok: true, 
        entryId: entryId,
        processed: true,
        gptScore: gptResult?.score || null
      });

    } finally {
      lock.releaseLock();
    }
    
  } catch (err) {
    Logger.log(`doPost error: ${err.stack || err}`);
    return jsonOut_({ ok: false, error: String(err) });
  }
}

// ========== SUBMISSIONS PROCESSING ==========
function writeToSubmissions_(payload) {
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const sh = ensureSheetWithHeaders_(ss, CFG.SUBMISSIONS_TAB, SUBMISSIONS_HEADERS);
  
  const row = normalizeForSubmissions_(payload);
  sh.appendRow(row);
  
  return row;
}

function normalizeForSubmissions_(p) {
  const timestampISO = new Date().toISOString();
  
  // Core fields
  const email = String(p.email || '').trim();
  const entryId = String(p.entryId || '').trim();
  const ticket = 0; // Legacy field, always 0
  const isPaid = String(p.isPaid || '').trim();
  
  // Numeric conversions
  const heightCm = toNumber_(p.heightCm);
  const heightIn = toNumber_(p.heightIn);
  const weightKg = toNumber_(p.weightKg);
  const weightLb = toNumber_(p.weightLb);
  const trainingAgeYears = toNumber_(p.trainingAgeYears);
  const age = toNumber_(p.age);
  
  // Social handle formatting
  let socialHandle = String(p.socialHandle || '').trim();
  if (!socialHandle) {
    socialHandle = 'Anonymous';
  } else if (!socialHandle.startsWith('@')) {
    socialHandle = '@' + socialHandle.replace(/^@+/, '');
  }
  
  // Photo URLs - handle malformed JSON from form
  const photoUrls = normalizePhotoUrls_(p.photoUrls);
  const photoUrlsJson = JSON.stringify(photoUrls);
  
  // Placeholders for GPT results
  const resultJson = '';
  const createdAtISO = '';
  
  return [
    timestampISO, email, entryId, ticket, isPaid,
    heightCm, heightIn, weightKg, weightLb, trainingAgeYears,
    socialHandle, photoUrlsJson, resultJson, createdAtISO, age
  ];
}

// ========== GPT PROCESSING ==========
// ========== JITTER HELPERS (ADD ABOVE callOpenAIForResult_) ==========

/** Deterministic 0..1 random from a seed string */
function _rand01_(seed) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  let acc = 0;
  // fold first 7 bytes into a 32-bit int
  for (let i = 0; i < 7; i++) acc = (acc * 256 + (bytes[i] & 0xff)) >>> 0;
return (acc % 1000000) / 1000000;
 } // 0..0.999999

/** Choose from array using deterministic r in [0,1) */
function _pick_(arr, r) {
  return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
}

/** Nudge a decimal score away from .0 or .5 using seed */
function _avoidRoundDecimal_(s, seed) {
  // If already non-round (not .0/.5), keep it
  const frac = Math.round((s - Math.floor(s)) * 10) / 10; // one-dec fraction
  if (!(frac === 0 || frac === 0.5)) return Math.round(s * 10) / 10;

  const opts = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9];
  const pick = _pick_(opts, _rand01_(seed + '|d_end'));
  const side = _rand01_(seed + '|d_side') < 0.5 ? -1 : 1;

  let x = s;
  // Try gentle move first
  x = x + side * pick;
  // If we crossed an integer awkwardly, re-center on a non-round within same neighborhood
  const baseInt = Math.floor(x);
  const preferUp = _rand01_(seed + '|d_pref') < 0.5;
  if (Math.abs(x - Math.round(x)) < 0.05) {
    x = baseInt + (preferUp ? (1 - pick) : pick);
  }
  x = Math.max(1, Math.min(100, x));
  return Math.round(x * 10) / 10;
}

/** Jitter overall score by ±0.9 max, keep one decimal, avoid .0/.5 */
function jitterOverallScore_(score, seedKey) {
  if (typeof score !== 'number' || !isFinite(score)) return score;
  const delta = (_rand01_(seedKey + '|ov_delta') * 1.8) - 0.9; // [-0.9, +0.9]
  let s = score + delta;
  s = Math.max(1, Math.min(100, s));
  s = Math.round(s * 10) / 10;
  s = _avoidRoundDecimal_(s, seedKey);
  return s;
}

/** True if integer ends with 0 or 5 */
function _isRoundInt_(n) { return n % 5 === 0; }

/** Snap an int off a 0/5 ending within a band */
function _offRoundInt_(n, low, high, seed) {
  if (!_isRoundInt_(n)) return n;
  const sign = _rand01_(seed + '|i_sign') < 0.5 ? -1 : 1;
  let x = n + sign;
  if (x < low) x = n + 1;
  if (x > high) x = n - 1;
  if (_isRoundInt_(x)) x = x + (x + 1 <= high ? 1 : -1);
  return Math.max(low, Math.min(high, x));
}

/** Jitter a single muscle integer within its 10-point band (keep category) */
function jitterMuscleInt_(n, seedKey) {
  if (typeof n !== 'number' || !isFinite(n)) return n;
  n = Math.round(n);
  const bandLow = Math.floor(n / 10) * 10;
  const bandHigh = Math.min(100, bandLow + 9);

  // Choose a small ±1/±2 integer shift
  const deltas = [-2, -1, 1, 2];
  const d = _pick_(deltas, _rand01_(seedKey + '|i_delta'));
  let x = n + d;

  // Stay inside the band
  if (x < bandLow) x = Math.min(bandHigh, n + Math.abs(d));
  if (x > bandHigh) x = Math.max(bandLow, n - Math.abs(d));

  // Avoid 0/5 endings
  x = _offRoundInt_(x, bandLow, bandHigh, seedKey + '|i_off');
  // Clamp global 0..100
  return Math.max(0, Math.min(100, x));
}

/** Diversify majors so at least 4/6 differ (light touch) */
function diversifyMajors_(majorObj, seedKey) {
  const order = ['Chest','Back','Shoulders','Legs','Arms','Midsection'];
  // Shuffle deterministically
  const shuffled = order.slice().sort((a,b) =>
    _rand01_(seedKey + '|ord|' + a) - _rand01_(seedKey + '|ord|' + b)
  );

  const seen = new Map(); // value -> count
  for (const name of shuffled) {
    let v = majorObj[name];
    if (typeof v !== 'number') continue;
    const bandLow = Math.floor(v / 10) * 10;
    const bandHigh = Math.min(100, bandLow + 9);

    const count = seen.get(v) || 0;
    if (count > 0) {
      // Nudge duplicates by ±2 within band, avoid 0/5 endings
      const sign = _rand01_(seedKey + '|dup|' + name) < 0.5 ? -1 : 1;
      let x = v + (2 * sign);
      if (x < bandLow) x = v + 2;
      if (x > bandHigh) x = v - 2;
      x = _offRoundInt_(x, bandLow, bandHigh, seedKey + '|dup_off|' + name);
      v = x;
    } else if (_isRoundInt_(v)) {
      // Push off 0/5 endings
      v = _offRoundInt_(v, bandLow, bandHigh, seedKey + '|maj_off|' + name);
    }
    majorObj[name] = v;
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  return majorObj;
}

/** Soft consistency touch-ups (keeps realism; optional but handy) */
function consistencyTune_(ratings, seedKey) {
  const M = ratings.major || {};
  const A = ratings.accessory || {};

  // Arms ≈ avg(Biceps, Triceps) ±3
  if (typeof M.Arms === 'number' && typeof A.Biceps === 'number' && typeof A.Triceps === 'number') {
    const tgt = Math.round((A.Biceps + A.Triceps) / 2);
    const diff = M.Arms - tgt;
    if (Math.abs(diff) > 3) {
      let adj = tgt + (diff > 0 ? 3 : -3);
      const low = Math.floor(M.Arms / 10) * 10, high = Math.min(100, low + 9);
      adj = _offRoundInt_(Math.max(low, Math.min(high, adj)), low, high, seedKey + '|arms_adj');
      M.Arms = adj;
    }
  }

  // Shoulders ≥ RearDelts - 2 and ≤ RearDelts + 7
  if (typeof M.Shoulders === 'number' && typeof A.RearDelts === 'number') {
    const low = Math.floor(M.Shoulders / 10) * 10, high = Math.min(100, low + 9);
    if (M.Shoulders < A.RearDelts - 2) {
      M.Shoulders = _offRoundInt_(Math.max(low, Math.min(high, A.RearDelts - 2)), low, high, seedKey + '|sh_low');
    }
    if (M.Shoulders > A.RearDelts + 7) {
      M.Shoulders = _offRoundInt_(Math.max(low, Math.min(high, A.RearDelts + 7)), low, high, seedKey + '|sh_high');
    }
  }

  // Legs ≈ avg(Quads, Hamstrings, Glutes) within ~8
  if (typeof M.Legs === 'number' && typeof A.Quads === 'number' && typeof A.Hamstrings === 'number' && typeof A.Glutes === 'number') {
    const avg = Math.round((A.Quads + A.Hamstrings + A.Glutes) / 3);
    const diff = M.Legs - avg;
    if (Math.abs(diff) > 8) {
      const low = Math.floor(M.Legs / 10) * 10, high = Math.min(100, low + 9);
      let adj = avg + (diff > 0 ? 8 : -8);
      M.Legs = _offRoundInt_(Math.max(low, Math.min(high, adj)), low, high, seedKey + '|legs_adj');
    }
  }

  ratings.major = M;
  ratings.accessory = A;
  return ratings;
}

/** Apply jitter to overall + all muscles (semi-random for resubmission incentive) */
function applyPostProcessJitter_(result, seedKey) {
  try {
    // Add timestamp component for resubmission variance (but keep user component for fairness)
    const timeComponent = Math.floor(Date.now() / (1000 * 60 * 15)); // Changes every 15 minutes
    const resubmissionSeed = seedKey + '|time|' + timeComponent;
    
    // Overall
    if (typeof result.score === 'number') {
      result.score = jitterOverallScore_(result.score, resubmissionSeed);
    }

    // Muscles (using resubmission seed for slight variance)
    if (result.muscleRatings && result.muscleRatings.major) {
      const major = result.muscleRatings.major;
      for (const k of Object.keys(major)) {
        if (typeof major[k] === 'number') {
          major[k] = jitterMuscleInt_(major[k], resubmissionSeed + '|maj|' + k);
        }
      }
      diversifyMajors_(major, resubmissionSeed);
    }
    if (result.muscleRatings && result.muscleRatings.accessory) {
      const acc = result.muscleRatings.accessory;
      for (const k of Object.keys(acc)) {
        if (typeof acc[k] === 'number') {
          acc[k] = jitterMuscleInt_(acc[k], resubmissionSeed + '|acc|' + k);
        }
      }
    }

    // Optional realism tuning
    if (result.muscleRatings) {
      result.muscleRatings = consistencyTune_(result.muscleRatings, resubmissionSeed);
    }

    return result;
  } catch (e) {
    // Fail-safe: if anything odd happens, just return original
    return result;
  }
}

// ========== ENHANCED GPT PROCESSING ==========
function callOpenAIForResult_(payload) {
  // Create image blocks for all photos
  const imageBlocks = payload.photoUrls.map(url => ({
    type: 'image_url',
    image_url: { url: String(url).trim() }
  }));
  
  const OPTIMIZED_PROMPT = `
You are **FlexCheck Judge** — a critical physique evaluator using competitive bodybuilding standards. Output **one JSON object only** matching the caller's schema exactly (no extra keys, no prose).

**REQUIRED JSON SCHEMA (match keys exactly):**
{
  "score": 0.0,                    // Overall physique score 1-100 (use one decimal place)
  "summary": "",                 // 50-60 words: balanced strengths/weaknesses
  "age": 0, "heightCm": 0, "weightKg": 0, "socialHandle": "", "imageUrls": [],
  "muscleRatings": {
    "major": {"Chest": 0, "Back": 0, "Shoulders": 0, "Legs": 0, "Arms": 0, "Midsection": 0},
    "accessory": {"Traps": 0, "Lats": 0, "Biceps": 0, "Triceps": 0, "Forearms": 0, "Glutes": 0, "Hamstrings": 0, "Quads": 0, "Calves": 0, "RearDelts": 0, "Obliques": 0}
  },
  "divisionFit": {"MensPhysique": 0, "ClassicPhysique": 0, "Bodybuilding212": 0, "OpenBodybuilding": 0},
  "bestExercises": [{"name": "", "reason": ""}],  // exactly 3 exercises, each reason 30–40 words
  "biomechanics": []             // 3–5 key structural observations
}

**10-POINT TIER RUBRIC (applies to OVERALL and EACH MUSCLE 0–100):**
• **90–100 (Elite Pro):** Dominant in 6–7 axes; world-class presence; extreme density and detail; near-flawless balance/symmetry.  
• **80–89 (National Level):** Strong in 5–6 axes; striking taper/shape; very high detail; minimal weak points.  
• **70–79 (Regional Show-Ready):** Good in 4–5 axes; competitive look; clear strengths with contained weaknesses.  
• **60–69 (Competitive Amateur):** Solid in 3–4 axes; above average gym physique; evident structure with gaps.  
• **50–59 (Trained Intermediate):** Visible development in 2–3 axes; inconsistent definition/balance.  
• **40–49 (Beginner+):** Some muscle; proportions/definition limited; clear weak regions.  
• **30–39 (Novice):** Minimal development; poor separation; soft or imbalanced overall.  
• **20–29 (Untrained):** Very little muscle; high body fat or extremely underdeveloped.  
• **10–19 (Severely Undertrained):** Negligible development across regions.  
• **1–9 (Edge Cases):** Avoid unless images grossly invalid; overall score must be ≥1.

**EVALUATION AXES (use for each muscle and for overall judgment):**
1) **Mass** (thickness/cross-section)  
2) **Proportions** (relative to adjacent muscles)  
3) **Definition** (separation, striations, vascularity)  
4) **Roundness/3D** (cap/fullness, silhouette)  
5) **Insertions** (belly length vs tendon, aesthetic leverage)  
6) **Symmetry** (L/R matching)  
7) **Balance** (upper/lower/midsection harmony)

**MUSCLE CRITERIA (brief, critical checklists):**
• **Chest (major):** Upper-pec fullness & delt tie-in; lower-pec line/mass; inner split; side-view thickness.  
• **Back (major):** Lat width (taper) + lower-lat; mid-back/rhomboid thickness; traps (upper/mid); erector detail; overall density.  
• **Shoulders (major):** Anterior/lateral/posterior balance; width; cap roundness; separation from chest/lats.  
• **Legs (major):** Quad sweep (VL/RF/VM) vs hamstrings; calf size relative to thigh; separation; overall lower-body proportion.  
• **Arms (major):** Biceps peak/belly length; triceps horseshoe/lateral head; forearms; overall arm thickness/definition.  
• **Midsection (major):** Rectus clarity (4–8 pack); obliques/serratus; waist tightness; contribution to V-taper.

**DIVISION FIT (0–100 practicality today):**
• **MensPhysique:** shoulder:waist ratio, lat width-driven taper, upper chest, tight midsection; legs de-emphasized.  
• **ClassicPhysique:** X-frame (wide clavicles/lats + tight waist + developed legs), balanced arms/torso; classic lines.  
• **Bodybuilding212:** shorter frames favor dense, even mass; strong calves/forearms; controlled waist.  
• **OpenBodybuilding:** extreme mass with conditioning and 3D fullness at scale; proportion intact.

**BIOMECHANICS (3–5 explicit observations):**
• **Clavicle width:** wide / average / narrow (taper leverage)  
• **Hip structure:** narrow / average / wide (waist:shoulder dynamics)  
• **Ribcage size:** wide / average / narrow (upper body mass potential)  
• **Insertion heights:** chest (low/avg/high), biceps (low/avg/high), lats (low/avg/high), calves (low/avg/high)  
• **Limb/torso ratios:** arm length (short/avg/long), leg length (short/avg/long), torso length (short/avg/long)  
State them concisely and image-grounded (e.g., "low lat insertions aiding V-taper; narrow hips; long arms").

**SUMMARY (60–80 words with RESUBMISSION CTA):**
Structure as: **[List concise 3 precise strengths]** + **[List consise 2 limiting factors]** + **[RESUBMISSION GUIDANCE]**. 

**RESUBMISSION GUIDANCE (20-40 words):** Include specific, actionable suggestions that could improve their score:
- Start with an Obvious CTA: "Want a Better Score?" then give the advice.
- Tell them how to maximize strenths & Bring Up Weaknesses
- Keep it Simple
- Encourage them to submit again

Make the resubmission guidance feel like insider tips that could genuinely unlock 2-5 more points on their next submission.

**BEST EXERCISES (exactly 3):**
Each item must include a name and a **30–40 word reason** tied to their structure (insertions, limb lengths, leverage) and the specific weakness it targets.

**RESUBMISSION OPTIMIZATION STRATEGY:**
Your goal is to make players feel they can improve their score by 3-8 points with better submission technique. In your summary, include ONE specific improvement from each category:


**STRICTNESS & SCORING ACCURACY:**
• Be **critical**: most lifters land **40–60** per region; give **80+** only with clear excellence across **5–7 axes**.  
• Use **<30** overall only for severely underdeveloped/obese presentations.  
• Never output overall score 0 (minimum 1).  
• Focus on accuracy first - precise evaluation within the correct 10-point band is essential.  
• If images are obstructed/low-quality, reflect that with conservative regional scores and mention it in the summary.

**OUTPUT RULE:**
Return **only** the JSON object with the exact schema keys above, using one decimal place for "score".
`;
  
  // User context with form data
  const userContext = JSON.stringify({
    entryId: payload.entryId,
    email: payload.email,
    isPaid: payload.isPaid,
    heightCm: payload.heightCm,
    heightIn: payload.heightIn,
    weightKg: payload.weightKg,
    weightLb: payload.weightLb,
    trainingAgeYears: payload.trainingAgeYears,
    socialHandle: payload.socialHandle,
    age: payload.age
  }, null, 2);
  
  const requestBody = {
    model: "gpt-4o",  // Changed from mini to 4o for better reasoning
    response_format: { type: 'json_object' },
    temperature: 0.7,  // Balanced for accuracy + some variance
    top_p: 0.9,       // Slight creativity while maintaining accuracy
    messages: [
      {
        role: 'system',
        content: OPTIMIZED_PROMPT
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Form data: ${userContext}` },
          ...imageBlocks
        ]
      }
    ]
  };
  
  const response = UrlFetchApp.fetch(AI.ENDPOINT, {
    method: 'POST',
    muteHttpExceptions: true,
    headers: {
      'Authorization': `Bearer ${AI.API_KEY}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(requestBody)
  });
  
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();
  
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`OpenAI API error ${statusCode}: ${responseText}`);
  }
  
  const json = JSON.parse(responseText);
  const content = json.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error('OpenAI returned no content');
  }
  
  const out = JSON.parse(content);
  
  // Build a stable seed for deterministic jitter per entry
  const seedKey = [payload.entryId, payload.email, payload.socialHandle].filter(Boolean).join('|') || (payload.photoUrls && payload.photoUrls[0]) || String(Date.now());

  // Apply post-processing jitter (overall + muscle ratings)
  const jittered = applyPostProcessJitter_(out, seedKey);
  return jittered;
}

function callGPTDirectly_(payload) {
  if (!AI.API_KEY) {
    throw new Error('OPENAI_API_KEY not found in Script Properties');
  }
  
  const photoUrls = normalizePhotoUrls_(payload.photoUrls);
  if (!photoUrls.length) {
    throw new Error('No valid photo URLs provided');
  }
  
  // Convert form data for GPT
  const gptPayload = {
    email: payload.email,
    entryId: payload.entryId,
    isPaid: payload.isPaid,
    heightCm: fillHeight_(payload.heightCm, payload.heightIn).cm,
    heightIn: fillHeight_(payload.heightCm, payload.heightIn).inches,
    weightKg: fillWeight_(payload.weightKg, payload.weightLb).kg,
    weightLb: fillWeight_(payload.weightKg, payload.weightLb).lb,
    trainingAgeYears: toNumber_(payload.trainingAgeYears),
    socialHandle: payload.socialHandle,
    age: toNumber_(payload.age),
    photoUrls: photoUrls
  };
  
  return callOpenAIForResult_(gptPayload);
}

function updateSubmissionWithGPT_(entryId, gptResult) {
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CFG.SUBMISSIONS_TAB);
  const headers = getHeaderMap_(sh);
  
  // Find the row with this entryId
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (String(row[headers['entryId']]).trim() === entryId) {
      const rowNumber = i + 2; // Account for header row
      const nowISO = new Date().toISOString();
      
      // Update resultJson and createdAtISO
      sh.getRange(rowNumber, headers['resultJson'] + 1).setValue(JSON.stringify(gptResult));
      sh.getRange(rowNumber, headers['createdAtISO'] + 1).setValue(nowISO);
      break;
    }
  }
}

// ========== PROCESSED TAB TRANSFORMATION ==========
function processCompletedEntries_() {
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const shSub = ss.getSheetByName(CFG.SUBMISSIONS_TAB);
  const shPro = ensureSheetWithHeaders_(ss, CFG.PROCESSED_TAB, PROCESSED_HEADERS);
  
  const subHeaders = getHeaderMap_(shSub);
  const proHeaders = getHeaderMap_(shPro);
  
  // Get all submissions data
  const subData = shSub.getRange(2, 1, Math.max(0, shSub.getLastRow() - 1), shSub.getLastColumn()).getValues();
  
  // Get existing processed entries to avoid duplicates
  const proData = shPro.getRange(2, 1, Math.max(0, shPro.getLastRow() - 1), shPro.getLastColumn()).getValues();
  const existingEntryIds = new Set(proData.map(row => String(row[proHeaders['entryId']]).trim()));
  
  const rowsToProcess = [];
  
  subData.forEach(row => {
    const entryId = String(row[subHeaders['entryId']] || '').trim();
    const resultJson = String(row[subHeaders['resultJson']] || '').trim();
    
    // Skip if no entryId, no results, or already processed
    if (!entryId || !resultJson || existingEntryIds.has(entryId)) {
      return;
    }
    
    const gptResult = safeJsonParse_(resultJson) || {};
    const timestampISO = String(row[subHeaders['timestampISO']] || '');
    const createdAtISO = String(row[subHeaders['createdAtISO']] || '');
    const weekKey = makeWeekKey_(timestampISO);
    
    // Fill missing height/weight data
    const heightData = fillHeight_(row[subHeaders['heightCm']], row[subHeaders['heightIn']]);
    const weightData = fillWeight_(row[subHeaders['weightKg']], row[subHeaders['weightLb']]);
    
    // Create processed row
    const processedRow = new Array(PROCESSED_HEADERS.length).fill('');
    
    processedRow[proHeaders['entryId']] = entryId;
    processedRow[proHeaders['ticket']] = String(row[subHeaders['ticket']] || 0);
    processedRow[proHeaders['email']] = String(row[subHeaders['email']] || '');
    processedRow[proHeaders['isPaid']] = String(row[subHeaders['isPaid']] || '');
    processedRow[proHeaders['createdAtISO']] = createdAtISO;
    processedRow[proHeaders['cachedAt']] = new Date().toISOString();
    processedRow[proHeaders['weekKey']] = weekKey;
    processedRow[proHeaders['score']] = toNumber_(gptResult.score);
    processedRow[proHeaders['summary']] = String(gptResult.summary || '');
    processedRow[proHeaders['divisionFit']] = JSON.stringify(gptResult.divisionFit || {});
    processedRow[proHeaders['muscleRatings']] = JSON.stringify(gptResult.muscleRatings || {});
    processedRow[proHeaders['age']] = toNumber_(row[subHeaders['age']]);
    processedRow[proHeaders['heightCm']] = heightData.cm;
    processedRow[proHeaders['heightIn']] = heightData.inches;
    processedRow[proHeaders['weightKg']] = weightData.kg;
    processedRow[proHeaders['weightLb']] = weightData.lb;
    processedRow[proHeaders['trainingAgeYears']] = toNumber_(row[subHeaders['trainingAgeYears']]);
    processedRow[proHeaders['socialHandle']] = String(row[subHeaders['socialHandle']] || '');
    processedRow[proHeaders['photos']] = String(row[subHeaders['photoUrls']] || '');
    processedRow[proHeaders['bestExercises']] = JSON.stringify(gptResult.bestExercises || []);
    processedRow[proHeaders['biomechanics']] = JSON.stringify(gptResult.biomechanics || []);
    
    rowsToProcess.push(processedRow);
  });
  
  // Batch append new rows
  if (rowsToProcess.length > 0) {
    const range = shPro.getRange(shPro.getLastRow() + 1, 1, rowsToProcess.length, PROCESSED_HEADERS.length);
    range.setValues(rowsToProcess);
  }
  
  return rowsToProcess.length;
}

// ========== EMAIL CONFIRMATION SYSTEM ==========
function sendConfirmationEmail_(email, entryId) {
  try {
    // Create player card URL with parameters
    const playerCardUrl = `https://www.gameplanfitness.com/flexcheck/flexcheck-player-card/?email=${encodeURIComponent(email)}&entryId=${encodeURIComponent(entryId)}`;
    
    // Calculate next championship Friday (every 4th Friday)
    const nextChampionshipDate = getNextChampionshipFriday_();
    
    // Email subject and content
    const subject = `FlexCheck Results Ready - Entry #${entryId}`;
    
    const plainBody = `
FlexCheck Results Ready

Your Flex has been Checked.

VIEW YOUR RESULTS:
${playerCardUrl}

Use FlexCheck anytime to track your progress with objective scoring and compete against other athletes.

UPCOMING CHAMPIONSHIP:
Next FlexCheck Championship: ${nextChampionshipDate}
Finish top 3 in any tier (top/mid/bot) to qualify for championship competition.

GET YOUR CREW INVOLVED:
Challenge your training partners to submit their FlexCheck. Compare scores and see who's really making gains.

Share FlexCheck: https://www.gameplanfitness.com/flexcheck/

Your entry is live on the leaderboard and eligible for weekly competitions.

Keep grinding,
The FlexCheck Team
GamePlan Fitness
    `;
    
    // Send plain text email
    GmailApp.sendEmail(
      email,
      subject,
      plainBody,
      {
        name: 'FlexCheck by GamePlan Fitness'
      }
    );
    
    Logger.log(`✅ Confirmation email sent to ${email} for entry ${entryId}`);
    
  } catch (error) {
    Logger.log(`❌ Failed to send confirmation email to ${email}: ${error.toString()}`);
    // Don't throw error - email failure shouldn't break the main process
  }
}

function getNextChampionshipFriday_() {
  const now = new Date();
  const centralTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Chicago"}));
  
  // Find the next 4th Friday (championship)
  let currentFriday = new Date(centralTime);
  const daysUntilFriday = (5 - centralTime.getDay() + 7) % 7 || 7;
  currentFriday.setDate(centralTime.getDate() + daysUntilFriday);
  
  // Check if we're past Thursday 7 PM deadline for this week
  const thursdayDeadline = new Date(currentFriday);
  thursdayDeadline.setDate(currentFriday.getDate() - 1);
  thursdayDeadline.setHours(19, 0, 0, 0);
  
  if (centralTime >= thursdayDeadline) {
    currentFriday.setDate(currentFriday.getDate() + 7);
  }
  
  // Find which Friday of the month this is
  const firstFridayOfMonth = new Date(currentFriday.getFullYear(), currentFriday.getMonth(), 1);
  firstFridayOfMonth.setDate(1 + (5 - firstFridayOfMonth.getDay() + 7) % 7);
  
  let fridayOfMonth = Math.floor((currentFriday.getDate() - firstFridayOfMonth.getDate()) / 7) + 1;
  
  // If current Friday is not the 4th Friday, find the next 4th Friday
  while (fridayOfMonth !== 4) {
    currentFriday.setDate(currentFriday.getDate() + 7);
    
    // Check if we've moved to next month
    if (currentFriday.getMonth() !== firstFridayOfMonth.getMonth()) {
      // Reset to first Friday of new month
      const newMonth = currentFriday.getMonth();
      firstFridayOfMonth.setFullYear(currentFriday.getFullYear(), newMonth, 1);
      firstFridayOfMonth.setDate(1 + (5 - firstFridayOfMonth.getDay() + 7) % 7);
      currentFriday = new Date(firstFridayOfMonth);
      fridayOfMonth = 1;
    } else {
      fridayOfMonth = Math.floor((currentFriday.getDate() - firstFridayOfMonth.getDate()) / 7) + 1;
    }
    
    // If we need 4th Friday and this month doesn't have one, go to next month
    if (fridayOfMonth > 4) {
      currentFriday.setMonth(currentFriday.getMonth() + 1);
      currentFriday.setDate(1);
      firstFridayOfMonth.setFullYear(currentFriday.getFullYear(), currentFriday.getMonth(), 1);
      firstFridayOfMonth.setDate(1 + (5 - firstFridayOfMonth.getDay() + 7) % 7);
      currentFriday = new Date(firstFridayOfMonth);
      fridayOfMonth = 1;
    }
  }
  
  // Format the date
  return currentFriday.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric', 
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Chicago'
  }) + ' at 7:00 PM CT';
}

// ========== HELPER FUNCTIONS ==========
function checkExistingEntry_(sheet, entryId) {
  const headers = getHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();
  
  if (lastRow < 2) {
    return { exists: false, data: null };
  }
  
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (String(row[headers['entryId']]).trim() === entryId) {
      return { 
        exists: true, 
        data: {
          email: row[headers['email']],
          timestamp: row[headers['timestampISO']],
          hasResult: !!row[headers['resultJson']]
        }
      };
    }
  }
  
  return { exists: false, data: null };
}
function readJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing POST body');
  }
  
  const raw = e.postData.contents;
  const contentType = (e.postData.type || '').toLowerCase();
  
  if (contentType.includes('application/json')) {
    return JSON.parse(raw);
  }
  
  // Handle form-encoded fallbacks
  const params = parseQueryString_(raw);
  if (params.payload) {
    return JSON.parse(params.payload);
  }
  
  throw new Error('Unsupported content type. Expected JSON.');
}

function parseQueryString_(qs) {
  const result = {};
  for (const part of (qs || '').split('&')) {
    if (!part) continue;
    const [key, value = ''] = part.split('=');
    result[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return result;
}

function normalizePhotoUrls_(input) {
  if (Array.isArray(input)) {
    return input.map(url => String(url || '').trim()).filter(Boolean);
  }
  
  if (!input) return [];
  
  // Handle malformed JSON from form with multiple quotes
  let cleaned = String(input).trim();
  
  // Fix malformed JSON like: "url1"",""url2"",""url3"
  cleaned = cleaned.replace(/"","/g, '","');
  cleaned = cleaned.replace(/^"/, '').replace(/"$/, ''); // Remove outer quotes
  
  try {
    // Try parsing as JSON array first
    if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
      return JSON.parse(cleaned).filter(Boolean);
    }
    
    // Split by comma and clean
    return cleaned.split(',').map(url => url.trim().replace(/^"/, '').replace(/"$/, '')).filter(Boolean);
  } catch (e) {
    // Fallback to simple comma split
    return String(input).split(',').map(url => url.trim()).filter(Boolean);
  }
}

function ensureSheetWithHeaders_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  // Ensure headers are correct
  const range = sheet.getRange(1, 1, 1, headers.length);
  const existingHeaders = range.getValues()[0] || [];
  
  const headersMatch = headers.every((header, index) => 
    String(existingHeaders[index] || '').trim() === header
  );
  
  if (!headersMatch) {
    sheet.clearContents();
    range.setValues([headers]);
  }
  
  return sheet;
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((header, index) => {
    map[String(header).trim()] = index;
  });
  return map;
}

function toNumber_(value) {
  if (value === null || value === undefined) return 0;
  const str = String(value).trim();
  if (!str) return 0;
  
  // Remove currency symbols and units
  const cleaned = str.replace(/[^\d.+-]/g, '');
  const num = Number(cleaned);
  
  return isFinite(num) ? Math.round(num * 10) / 10 : 0;
}

function fillHeight_(cm, inches) {
  let outCm = toNumber_(cm);
  let outInches = toNumber_(inches);
  
  if (!outCm && outInches) {
    outCm = Math.round(outInches * 2.54 * 10) / 10;
  }
  if (!outInches && outCm) {
    outInches = Math.round(outCm / 2.54 * 10) / 10;
  }
  
  return { cm: outCm, inches: outInches };
}

function fillWeight_(kg, lb) {
  let outKg = toNumber_(kg);
  let outLb = toNumber_(lb);
  
  if (!outKg && outLb) {
    outKg = Math.round(outLb * 0.453592 * 10) / 10;
  }
  if (!outLb && outKg) {
    outLb = Math.round(outKg / 0.453592 * 10) / 10;
  }
  
  return { kg: outKg, lb: outLb };
}

function makeWeekKey_(timestampISO) {
  if (!timestampISO) return '';
  
  const date = new Date(timestampISO);
  if (isNaN(date)) return '';
  
  // Convert to Central Time (Chicago timezone)
  const centralTime = new Date(date.toLocaleString("en-US", {timeZone: "America/Chicago"}));
  
  // Thursday 7:00 PM CT is the deadline
  const deadlineHour = 19; // 7 PM in 24-hour format
  
  // If it's before Thursday 7 PM, use previous week's Thursday
  // If it's Thursday 7 PM or later, use current week's Thursday
  
  let targetThursday;
  const dayOfWeek = centralTime.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
  const hour = centralTime.getHours();
  
  if (dayOfWeek < 4) {
    // Sunday, Monday, Tuesday, Wednesday - use previous Thursday
    const daysBack = dayOfWeek + 3; // Sun=3, Mon=4, Tue=5, Wed=6 days back
    targetThursday = new Date(centralTime);
    targetThursday.setDate(centralTime.getDate() - daysBack);
  } else if (dayOfWeek === 4) {
    // Thursday
    if (hour < deadlineHour) {
      // Before 7 PM Thursday - use previous Thursday
      targetThursday = new Date(centralTime);
      targetThursday.setDate(centralTime.getDate() - 7);
    } else {
      // 7 PM Thursday or later - use current Thursday
      targetThursday = new Date(centralTime);
    }
  } else {
    // Friday (5) or Saturday (6) - use current week's Thursday
    const daysBack = dayOfWeek - 4; // Fri=1, Sat=2 days back
    targetThursday = new Date(centralTime);
    targetThursday.setDate(centralTime.getDate() - daysBack);
  }
  
  // Handle fifth Fridays in a month - roll to next month's first competition
  const friday = new Date(targetThursday);
  friday.setDate(targetThursday.getDate() + 1); // Friday after Thursday
  
  // Check if this Friday is the 5th Friday of the month
  const firstDayOfMonth = new Date(friday.getFullYear(), friday.getMonth(), 1);
  const firstFriday = new Date(firstDayOfMonth);
  firstFriday.setDate(1 + (5 - firstDayOfMonth.getDay()) % 7); // First Friday of month
  
  // Count Fridays in this month
  let fridayCount = 0;
  const tempFriday = new Date(firstFriday);
  while (tempFriday.getMonth() === friday.getMonth()) {
    if (tempFriday.getTime() <= friday.getTime()) {
      fridayCount++;
    }
    tempFriday.setDate(tempFriday.getDate() + 7);
  }
  
  // If this is the 5th Friday, roll to next month's first Thursday
  if (fridayCount === 5) {
    const nextMonth = new Date(friday.getFullYear(), friday.getMonth() + 1, 1);
    const nextFirstFriday = new Date(nextMonth);
    nextFirstFriday.setDate(1 + (5 - nextMonth.getDay()) % 7);
    targetThursday = new Date(nextFirstFriday);
    targetThursday.setDate(nextFirstFriday.getDate() - 1); // Thursday before first Friday
  }
  
  // Format as YYYY-MM-DD
  const year = targetThursday.getFullYear();
  const month = String(targetThursday.getMonth() + 1).padStart(2, '0');
  const day = String(targetThursday.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

function safeJsonParse_(str) {
  try {
    return JSON.parse(String(str || ''));
  } catch (e) {
    return null;
  }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========== MANUAL PROCESSING FUNCTIONS (for testing) ==========
function manualProcessPendingEntries() {
  return processCompletedEntries_();
}

function testGPTCall() {
  const testPayload = {
    email: "test@example.com",
    entryId: "test123",
    isPaid: "$5.00",
    heightIn: 66,
    weightLb: 155,
    trainingAgeYears: 14,
    socialHandle: "test_user",
    age: 26,
    photoUrls: ["https://example.com/photo1.jpg"]
  };
  
  return callGPTDirectly_(testPayload);
}