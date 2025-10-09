// ============================================
// FlexCheck Auth System v5.1 - With MailerSend
// ============================================

// GLOBAL SETTING - Keep in sync with frontend CONFIG.DEV_MODE
const DEFAULT_TEST_MODE = false;  // ← SET TO false FOR PRODUCTION

const SHEET_ID = '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0';
const VOTERS_TAB = 'Voters';
const VERIFY_URL_BASE = 'https://www.gameplanfitness.com/flexcheck/voting/';
const TZ = 'America/Chicago';

function getMailerSendConfig() {
  const props = PropertiesService.getScriptProperties();
  const apiToken = props.getProperty('MAILERSEND_API_TOKEN');
  const fromEmail = props.getProperty('MAILERSEND_FROM_EMAIL');
  
  // Log configuration status for debugging
  Logger.log('MailerSend Config Check:');
  Logger.log('- API Token configured: ' + (apiToken ? 'YES' : 'NO'));
  Logger.log('- From Email configured: ' + (fromEmail ? 'YES' : 'NO'));
  
  return {
    API_TOKEN: apiToken || '',
    API_URL: 'https://api.mailersend.com/v1/email',
    FROM_EMAIL: fromEmail || 'noreply@gameplanfitness.com',
    FROM_NAME: 'GamePlan FlexCheck'
  };
}

// Static coupon configuration
const COUPON_CONFIG = {
  DISCOUNT_PERCENT: 15,
  COUPON_CODE: 'FLEXCHECK15',
  VALID_DAYS: 7
};

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;
    
    if (!action) {
      result = {
        success: true,
        message: 'FlexCheck Auth API v5.1',
        timestamp: new Date().toISOString()
      };
    } else if (action === 'authenticateEmail') {
      result = authenticateEmail(e.parameter.email, e.parameter.devOverride);
    } else if (action === 'verifyEmail') {
      result = verifyEmail(e.parameter.token, e.parameter.devOverride);
    } else if (action === 'getVoterProfile') {
      result = getVoterProfile(e.parameter.email);
    } else if (action === 'sendCoupon') {
      result = sendCouponEmail(e.parameter.email);
    } else {
      result = { success: false, message: 'Invalid action' };
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    Logger.log('❌ Error: ' + error.toString());
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: 'Server error: ' + error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// MAILERSEND EMAIL FUNCTIONS
// ============================================

function sendEmailViaMailerSend(to, subject, plainTextContent) {
  try {
    const MAILERSEND = getMailerSendConfig();
    
    if (!MAILERSEND.API_TOKEN) {
      Logger.log('⚠️ MailerSend API token not configured, using fallback');
      return sendEmailFallback(to, subject, plainTextContent);
    }
    
    const payload = {
      from: {
        email: MAILERSEND.FROM_EMAIL,
        name: MAILERSEND.FROM_NAME
      },
      to: [{
        email: to
      }],
      subject: subject,
      text: plainTextContent  // Plain text only for better deliverability
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + MAILERSEND.API_TOKEN,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(MAILERSEND.API_URL, options);
    const responseCode = response.getResponseCode();
    
    if (responseCode === 202) {
      Logger.log('✅ Email sent via MailerSend to: ' + to);
      return { success: true, message: 'Email sent successfully' };
    } else {
      const errorText = response.getContentText();
      Logger.log('❌ MailerSend error: ' + errorText);
      return sendEmailFallback(to, subject, plainTextContent);
    }
    
  } catch (error) {
    Logger.log('❌ MailerSend exception: ' + error.toString());
    return sendEmailFallback(to, subject, plainTextContent);
  }
}

function sendEmailFallback(to, subject, plainTextContent) {
  try {
    const MAILERSEND = getMailerSendConfig();
    GmailApp.sendEmail(to, subject, plainTextContent, {
      name: MAILERSEND.FROM_NAME
    });
    Logger.log('✅ Email sent via Gmail fallback to: ' + to);
    return { success: true, message: 'Email sent via fallback' };
  } catch (error) {
    Logger.log('❌ Email send failed: ' + error.toString());
    return { success: false, message: 'Failed to send email' };
  }
}

// ============================================
// SEND VERIFICATION EMAIL (Updated)
// ============================================

function sendVerificationEmail(email, token) {
  try {
    const verifyLink = `${VERIFY_URL_BASE}?token=${token}`;
    const subject = 'Verify your FlexCheck account';
    
    const plainTextContent = `Welcome to FlexCheck Voting!

Thanks for signing up! Please verify your email address to start voting.

Click here to verify your email:
${verifyLink}

This link will expire in 24 hours.

If you didn't sign up for FlexCheck, you can safely ignore this email.

--
GamePlan Fitness
© 2025 GamePlan 180 LLC. All rights reserved.`;
    
    return sendEmailViaMailerSend(email, subject, plainTextContent);
    
  } catch (error) {
    Logger.log('❌ Email send failed: ' + error.toString());
    return { success: false, message: error.toString() };
  }
}

// ============================================
// SEND COUPON EMAIL (New)
// ============================================

function sendCouponEmail(email) {
  Logger.log('═══════════════════════════════════');
  Logger.log('🎁 SEND COUPON: ' + email);
  Logger.log('═══════════════════════════════════');
  
  try {
    if (!email || !validateEmail(email)) {
      return { success: false, message: 'Invalid email address' };
    }
    
    const couponCode = COUPON_CONFIG.COUPON_CODE;
    const discountPercent = COUPON_CONFIG.DISCOUNT_PERCENT;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + COUPON_CONFIG.VALID_DAYS);
    const expiryStr = Utilities.formatDate(expiryDate, TZ, 'MMMM d, yyyy');
    
    const subject = `Your ${discountPercent}% OFF FlexCheck Coupon!`;
    
    const plainTextContent = `Thanks for voting in FlexCheck!

Here's your exclusive discount code:

=====================
${couponCode}
${discountPercent}% OFF
Valid until: ${expiryStr}
=====================

How to use your coupon:
1. Visit gameplanfitness.com/flexcheck
2. Submit a FlexCheck  
3. Enter code ${couponCode} at checkout
4. Enjoy ${discountPercent}% off your order!

--
GamePlan Fitness
© 2025 GamePlan 180 LLC. All rights reserved.`;
    
    const result = sendEmailViaMailerSend(email, subject, plainTextContent);
    
    if (result.success) {
      logCouponIssuance(email, couponCode);
      
      return {
        success: true,
        message: 'Coupon sent successfully',
        couponCode: couponCode
      };
    } else {
      return result;
    }
    
  } catch (error) {
    Logger.log('❌ Coupon send error: ' + error.toString());
    return { success: false, message: 'Failed to send coupon' };
  }
}

// ============================================
// LOG COUPON ISSUANCE (For tracking)
// ============================================

function logCouponIssuance(email, couponCode) {
  try {
    // TODO: Implement coupon tracking in a separate sheet
    // For now, just log it
    Logger.log(`✅ Coupon issued: ${couponCode} to ${email}`);
    
    // Future implementation:
    // const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Coupons');
    // sheet.appendRow([email, couponCode, new Date(), COUPON_CONFIG.DISCOUNT_PERCENT]);
    
  } catch (error) {
    Logger.log('Failed to log coupon: ' + error.toString());
  }
}

// ============================================
// WEEK KEY FUNCTIONS
// ============================================

function getCurrentWeekKey() {
  const now = new Date();
  const ct = toCt_(now);
  const anchor = weekAnchorFriday_(ct);
  return Utilities.formatDate(anchor, TZ, 'yyyy-MM-dd');
}

function toCt_(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const fmt = Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  return new Date(fmt);
}

function weekAnchorFriday_(ct) {
  const wd = parseInt(Utilities.formatDate(ct, TZ, 'u'), 10);
  const daysSinceFri = (wd >= 5) ? (wd - 5) : (wd + 2);
  const fri = new Date(ct);
  fri.setDate(ct.getDate() - daysSinceFri);
  fri.setHours(20, 0, 0, 0);
  if (ct < fri) { fri.setDate(fri.getDate() - 7); }
  return fri;
}

// ============================================
// CHECK IF VOTING WINDOW IS OPEN
// ============================================

function isVotingWindowOpen(devOverride) {
  // Check if frontend passed devOverride, otherwise use default
  const testMode = devOverride === 'true' || devOverride === true || 
                   (devOverride === undefined && DEFAULT_TEST_MODE);
  
  if (testMode) {
    Logger.log('🔧 Test mode active - voting window open');
    return true;
  }
  
  const now = new Date();
  const TZ = 'America/Chicago';
  const ct = new Date(Utilities.formatDate(now, TZ, "yyyy-MM-dd'T'HH:mm:ss"));
  const day = ct.getDay();
  const hour = ct.getHours();
  
  return (day === 4 && hour >= 19) || (day === 5 && hour < 19);
}

// ============================================
// AUTHENTICATE EMAIL
// ============================================

function authenticateEmail(email, devOverride) {
  Logger.log('═══════════════════════════════════');
  Logger.log('🔐 AUTHENTICATE: ' + email);
  Logger.log('DevOverride: ' + devOverride);
  Logger.log('═══════════════════════════════════');
  
  try {
    if (!email || !validateEmail(email)) {
      return { success: false, message: 'Invalid email address' };
    }
    
    if (!isVotingWindowOpen(devOverride)) {
      Logger.log('❌ Login blocked - voting window closed');
      return {
        success: false,
        message: 'Voting is closed. Login opens Thursday 7pm CT.',
        votingClosed: true
      };
    }
    
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTERS_TAB);
    if (!sheet) {
      return { success: false, message: 'Configuration error' };
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const cols = {
      email: headers.indexOf('email'),
      verified: headers.indexOf('verified'),
      created: headers.indexOf('created'),
      weekKey: headers.indexOf('weekKey'),
      voted_top: headers.indexOf('voted_top'),
      voted_mid: headers.indexOf('voted_mid'),
      voted_low: headers.indexOf('voted_low'),
      verification_token: headers.indexOf('verification_token'),
      last_login: headers.indexOf('last_login')
    };
    
    let voterRow = null;
    let rowIndex = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][cols.email] === email) {
        voterRow = data[i];
        rowIndex = i + 1;
        break;
      }
    }
    
    const currentWeekKey = getCurrentWeekKey();
    const now = new Date().toISOString();
    
    if (voterRow) {
      // Existing voter
      Logger.log('✓ Found existing voter at row ' + rowIndex);
      
      if (cols.last_login >= 0) {
        sheet.getRange(rowIndex, cols.last_login + 1).setValue(now);
      }
      
      const voterProfile = {
        email: email,
        verified: voterRow[cols.verified] === true || voterRow[cols.verified] === 'TRUE',
        weekKey: voterRow[cols.weekKey] || currentWeekKey,
        voted_top: voterRow[cols.voted_top] === true || voterRow[cols.voted_top] === 'TRUE',
        voted_mid: voterRow[cols.voted_mid] === true || voterRow[cols.voted_mid] === 'TRUE',
        voted_low: voterRow[cols.voted_low] === true || voterRow[cols.voted_low] === 'TRUE',
        created: voterRow[cols.created],
        last_login: now
      };
      
      Logger.log('Profile:', JSON.stringify(voterProfile));
      
      if (!voterProfile.verified) {
        const existingToken = voterRow[cols.verification_token];
        let emailResult;
        
        if (existingToken) {
          Logger.log('Resending verification email');
          emailResult = sendVerificationEmail(email, existingToken);
        } else {
          const newToken = generateToken();
          if (cols.verification_token >= 0) {
            sheet.getRange(rowIndex, cols.verification_token + 1).setValue(newToken);
            emailResult = sendVerificationEmail(email, newToken);
          }
        }
        
        return {
          success: true,
          action: 'PENDING_VERIFICATION',
          message: 'Please check your email to verify',
          voter: voterProfile,
          emailSent: emailResult.success
        };
      }
      
      Logger.log('✅ Login successful');
      
      return {
        success: true,
        action: 'LOGIN',
        message: 'Login successful',
        voter: voterProfile
      };
      
    } else {
      // New voter
      Logger.log('✓ Creating new voter');
      
      const verificationToken = generateToken();
      const newRow = new Array(headers.length).fill('');
      
      newRow[cols.email] = email;
      newRow[cols.verified] = false;
      newRow[cols.created] = now;
      newRow[cols.weekKey] = currentWeekKey;
      newRow[cols.voted_top] = false;
      newRow[cols.voted_mid] = false;
      newRow[cols.voted_low] = false;
      newRow[cols.verification_token] = verificationToken;
      if (cols.last_login >= 0) newRow[cols.last_login] = now;
      
      sheet.appendRow(newRow);
      Logger.log('✓ New voter row appended');
      
      const emailResult = sendVerificationEmail(email, verificationToken);
      Logger.log('✓ Verification email sent: ' + emailResult.success);
      
      return {
        success: true,
        action: 'REGISTER',
        message: 'Registration successful! Please check your email.',
        voter: {
          email: email,
          verified: false,
          weekKey: currentWeekKey,
          voted_top: false,
          voted_mid: false,
          voted_low: false,
          created: now,
          last_login: now
        },
        emailSent: emailResult.success
      };
    }
  } catch (error) {
    Logger.log('❌ Error: ' + error.toString());
    return { success: false, message: 'Server error: ' + error.message };
  }
}

// ============================================
// VERIFY EMAIL
// ============================================

function verifyEmail(token, devOverride) {
  Logger.log('═══════════════════════════════════');
  Logger.log('✉️  VERIFY EMAIL: ' + token);
  Logger.log('DevOverride: ' + devOverride);
  Logger.log('═══════════════════════════════════');
  
  try {
    if (!token) {
      return { success: false, message: 'Invalid token' };
    }
    
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTERS_TAB);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const verificationTokenCol = headers.indexOf('verification_token');
    const verifiedCol = headers.indexOf('verified');
    const emailCol = headers.indexOf('email');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][verificationTokenCol] === token) {
        const rowIndex = i + 1;
        
        Logger.log('✓ Token found at row ' + rowIndex);
        
        sheet.getRange(rowIndex, verifiedCol + 1).setValue(true);
        sheet.getRange(rowIndex, verificationTokenCol + 1).setValue('');
        
        Logger.log('✅ Email verified successfully');
        
        return {
          success: true,
          message: 'Email verified!',
          email: data[i][emailCol]
        };
      }
    }
    
    Logger.log('❌ Token not found');
    return { success: false, message: 'Invalid or expired token' };
    
  } catch (error) {
    Logger.log('❌ Error: ' + error.toString());
    return { success: false, message: 'Server error: ' + error.message };
  }
}

// ============================================
// GET VOTER PROFILE
// ============================================

function getVoterProfile(email) {
  try {
    if (!email) {
      return { success: false, message: 'Email required' };
    }
    
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTERS_TAB);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const emailCol = headers.indexOf('email');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][emailCol] === email) {
        const voterProfile = {};
        headers.forEach((header, index) => {
          if (header !== 'verification_token') {
            voterProfile[header] = data[i][index];
          }
        });
        
        return {
          success: true,
          voter: voterProfile
        };
      }
    }
    
    return { success: false, message: 'Voter not found' };
  } catch (error) {
    return { success: false, message: 'Server error: ' + error.message };
  }
}

// ============================================
// UTILITIES
// ============================================

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function testMailerSend() {
  const config = getMailerSendConfig();
  Logger.log('Config:', config);
  
  // Test sending an email
  const result = sendEmailViaMailerSend(
    'your-test-email@example.com',  // Replace with your email
    'Test Email from FlexCheck',
    'This is a test email to verify MailerSend is working.'
  );
  
  Logger.log('Test result:', result);
}