// ===== DEBUG MODE - BLOCK ALL REDIRECTS =====
console.log('[DEBUG] ===== VERIFY OTP PAGE LOADED - REDIRECTS BLOCKED =====');

// Set flag BEFORE any imports load
window.DEBUG_BLOCK_REDIRECT = true;
sessionStorage.setItem('DEBUG_BLOCK_REDIRECT', 'true');

// Block navigation attempts without redefining href
window.addEventListener('beforeunload', function(e) {
  console.log('[DEBUG] Blocked navigation attempt');
  e.preventDefault();
  e.returnValue = 'Debug mode - leaving will lose logs';
  return 'Debug mode - leaving will lose logs';
});

// Override navigation methods (these are safer than href)
const originalAssign = window.location.assign;
const originalReplace = window.location.replace;

window.location.assign = function(url) {
  console.log('[DEBUG] BLOCKED assign to:', url);
  console.trace();
  alert('BLOCKED redirect to: ' + url + '\nCheck console for stack trace');
};

window.location.replace = function(url) {
  console.log('[DEBUG] BLOCKED replace to:', url);
  console.trace();
  alert('BLOCKED redirect to: ' + url + '\nCheck console for stack trace');
};

console.log('[DEBUG] Redirect blocking active');
// ===== END DEBUG BLOCK =====


// js/screens/verify-otp.js
import { auth, db, functions } from '../firebase-config.js';
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// BLOCK ALL REDIRECTS FOR DEBUGGING
console.log('[DEBUG] ===== VERIFY OTP PAGE LOADED =====');
console.log('[DEBUG] Blocking all redirects for debugging');

// Override window.location methods to prevent redirects
const originalHref = window.location.href;
Object.defineProperty(window.location, 'href', {
  set: function(url) {
    console.log('[DEBUG] BLOCKED redirect to:', url);
    console.log('[DEBUG] Stack trace:', new Error().stack);
    alert('[DEBUG] Redirect blocked to: ' + url + '\nCheck console for logs');
    // Don't actually redirect
  },
  get: function() {
    return originalHref;
  }
});

// Also block replace and assign
window.location.replace = function(url) {
  console.log('[DEBUG] BLOCKED location.replace to:', url);
  alert('[DEBUG] Redirect blocked (replace) to: ' + url);
};
window.location.assign = function(url) {
  console.log('[DEBUG] BLOCKED location.assign to:', url);
  alert('[DEBUG] Redirect blocked (assign) to: ' + url);
};

// Temp kennel name generator
function tempKennelName(requested) {
  let hash = 0;
  for (let i = 0; i < requested.length; i++) {
    const char = requested.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const unsignedHash = hash >>> 0;
  const base36 = unsignedHash.toString(36).toUpperCase();
  return `PENDING-${base36}`;
}

class VerifyOtpManager {
  constructor() {
    console.log('[DEBUG] VerifyOtpManager constructor started');
    
    const sessionData = JSON.parse(sessionStorage.getItem('signupData') || '{}');
    console.log('[DEBUG] sessionData loaded:', sessionData);
    
    this.data = {
      phone: sessionData.phone,
      pinId: sessionData.pinId,
      hashHandle: sessionData.hashHandle,
      firstName: sessionData.firstName,
      lastName: sessionData.lastName,
      country: sessionData.country,
      state: sessionData.state,
      kennel: sessionData.kennel,
      designation: sessionData.designation,
      isFirebase: sessionData.isFirebase || false,
      isSignup: sessionData.isSignup || false
    };

    console.log('[DEBUG] this.data prepared:', this.data);

    if (!this.data.phone || !this.data.pinId) {
      console.error('[DEBUG] MISSING phone or pinId!');
      console.error('[DEBUG] phone:', this.data.phone);
      console.error('[DEBUG] pinId:', this.data.pinId);
      alert('Session expired. Please start again.');
      // DO NOT redirect - let user see the error
      return;
    }
    
    this.init();
  }

  init() {
    console.log('[DEBUG] init() called');
    
    const phoneDisplay = document.getElementById('phoneDisplay');
    if (phoneDisplay) {
      phoneDisplay.textContent = this.data.phone;
      console.log('[DEBUG] phoneDisplay set to:', this.data.phone);
    } else {
      console.error('[DEBUG] phoneDisplay element not found!');
    }
    
    const btnVerify = document.getElementById('btnVerify');
    const btnResend = document.getElementById('btnResend');
    
    if (btnVerify) {
      btnVerify.addEventListener('click', () => this.verifyOtp());
      console.log('[DEBUG] btnVerify listener attached');
    } else {
      console.error('[DEBUG] btnVerify not found!');
    }
    
    if (btnResend) {
      btnResend.addEventListener('click', () => this.resendOtp());
      console.log('[DEBUG] btnResend listener attached');
    } else {
      console.error('[DEBUG] btnResend not found!');
    }
  }

  async verifyOtp() {
    console.log('[DEBUG] ===== verifyOtp() STARTED =====');
    
    const otp = document.getElementById('etOtp').value.trim();
    console.log('[DEBUG] OTP entered:', otp);
    
    if (otp.length !== 6) {
      console.error('[DEBUG] OTP length invalid:', otp.length);
      alert("Enter 6-digit OTP code");
      return;
    }
    
    const btn = document.getElementById('btnVerify');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    
    try {
      console.log('[DEBUG] Calling verifyOtpHybrid...');
      console.log('[DEBUG] Phone:', this.data.phone);
      console.log('[DEBUG] PinId:', this.data.pinId);
      
      const verifyOtpHybrid = httpsCallable(functions, 'verifyOtpHybrid');
      const result = await verifyOtpHybrid({
        phone: this.data.phone,
        pinId: this.data.pinId,
        pin: otp
      });
      
      console.log('[DEBUG] verifyOtpHybrid SUCCESS');
      console.log('[DEBUG] Full result:', result);
      console.log('[DEBUG] result.data:', result.data);
      
      const { token, isExistingUser } = result.data;
      console.log('[DEBUG] token received:', token ? 'YES (length: ' + token.length + ')' : 'NO');
      console.log('[DEBUG] isExistingUser:', isExistingUser);
      
      if (!token) {
        console.error('[DEBUG] NO TOKEN in result!');
        throw new Error("No authentication token received");
      }
      
      // Step 1: Sign in to Firebase Auth
      console.log('[DEBUG] Calling signInWithCustomToken...');
      const userCredential = await signInWithCustomToken(auth, token);
      console.log('[DEBUG] signInWithCustomToken SUCCESS');
      console.log('[DEBUG] User UID:', userCredential.user?.uid);
      console.log('[DEBUG] Auth currentUser:', auth.currentUser?.uid);
      
      // Step 2: If signup, create user record
      if (this.data.isSignup) {
        console.log('[DEBUG] isSignup=true, calling createUserRecord()...');
        await this.createUserRecord();
        console.log('[DEBUG] createUserRecord() completed');
      } else {
        console.log('[DEBUG] isSignup=false, login flow complete');
        console.log('[DEBUG] Would redirect to index.html but BLOCKED');
      }
      
      console.log('[DEBUG] ===== verifyOtp() COMPLETED SUCCESSFULLY =====');
      
    } catch (error) {
      console.error('[DEBUG] ===== verifyOtp() ERROR =====');
      console.error('[DEBUG] Error object:', error);
      console.error('[DEBUG] Error message:', error.message);
      console.error('[DEBUG] Error code:', error.code);
      console.error('[DEBUG] Error stack:', error.stack);
      
      alert('Error: ' + error.message);
      btn.disabled = false;
      btn.textContent = 'VERIFY';
    }
  }

  async createUserRecord() {
    console.log('[DEBUG] this.data contents:', {
  phone: this.data.phone,
  hashHandle: this.data.hashHandle,
  firstName: this.data.firstName,
  lastName: this.data.lastName,
  country: this.data.country,
  state: this.data.state,
  kennel: this.data.kennel,
  designation: this.data.designation
});

// Check for undefined values
const required = ['phone', 'hashHandle', 'firstName', 'lastName', 'country', 'state', 'kennel', 'designation'];
const missing = required.filter(field => !this.data[field]);
if (missing.length > 0) {
  console.error('[DEBUG] MISSING required fields:', missing);
  throw new Error(`Missing required fields: ${missing.join(', ')}`);
}
    console.log('[DEBUG] ===== createUserRecord() STARTED =====');
    
    const user = auth.currentUser;
    console.log('[DEBUG] auth.currentUser:', user?.uid);
    
    if (!user) {
      console.error('[DEBUG] No current user!');
      throw new Error("Authentication failed - no user");
    }
    
    const uid = user.uid;
    console.log('[DEBUG] UID:', uid);
    
    // Create fake email from phone
    let cleanPhone = this.data.phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '234' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }
    const fakeEmail = `user${cleanPhone}@h3global.app`;
    console.log('[DEBUG] fakeEmail:', fakeEmail);
    
    const userRef = doc(db, "users", uid);
    const phoneRef = doc(db, "phoneNumbers", this.data.phone);
    
    console.log('[DEBUG] userRef path:', userRef.path);
    console.log('[DEBUG] phoneRef path:', phoneRef.path);
    
    const userMap = {
      hashHandle: this.data.hashHandle,
      hashHandleLower: this.data.hashHandle.toLowerCase(),
      firstName: this.data.firstName,
      lastName: this.data.lastName,
      phone: this.data.phone,
      email: fakeEmail,
      country: this.data.country,
      state: this.data.state,
      kennel: this.data.kennel,
      designation: this.data.designation,
      createdWith: "termii",
      createdAt: serverTimestamp(),
      walletPending: true
    };
    
    if (this.data.designation === "Admin") {
      userMap.role = "Tier 1";
    } else if (["Grand Master", "Hash Master", "On Sec", "Religious Adviser"].includes(this.data.designation)) {
      userMap.role = "Tier 2";
    }
    
    console.log('[DEBUG] userMap prepared:', JSON.stringify(userMap, null, 2));
    
    try {
      // Step 1: Check if phone exists
      console.log('[DEBUG] Checking phone existence...');
      const phoneCheck = await getDoc(phoneRef);
      console.log('[DEBUG] phoneCheck.exists():', phoneCheck.exists());
      
      if (phoneCheck.exists()) {
        console.error('[DEBUG] Phone already exists!');
        throw new Error("This phone number is already registered. Please login instead.");
      }
      
      // Step 2: Create phone document
      console.log('[DEBUG] Creating phone document...');
      await setDoc(phoneRef, { createdAt: serverTimestamp() });
      console.log('[DEBUG] Phone document CREATED successfully');
      
      // Step 3: Create user document
      console.log('[DEBUG] Creating user document...');
      await setDoc(userRef, userMap);
      console.log('[DEBUG] User document CREATED successfully');
      
      // Step 4: Handle designation
      const noTierRoles = ['Hasher', 'Member', 'Visitor'];
      if (!noTierRoles.includes(this.data.designation)) {
        console.log('[DEBUG] Creating designation...');
        const designationPath = this.data.designation === "Admin" ? "Admin" : this.data.kennel;
        const designationRef = doc(db, "designations", designationPath);
        await setDoc(designationRef, {
          [this.data.designation]: this.data.phone
        }, { merge: true });
        console.log('[DEBUG] Designation created');
      } else {
        console.log('[DEBUG] Skipping designation (noTierRole)');
      }
      
      console.log('[DEBUG] ===== ALL DOCUMENTS CREATED SUCCESSFULLY =====');
      
    } catch (error) {
      console.error('[DEBUG] ===== createUserRecord() ERROR =====');
      console.error('[DEBUG] Error:', error);
      console.error('[DEBUG] Error code:', error.code);
      console.error('[DEBUG] Error message:', error.message);
      throw error;
    }
    
    // DO NOT clear sessionStorage or redirect - keep page alive for debugging
    console.log('[DEBUG] SKIPPING sessionStorage.removeItem and redirect');
    console.log('[DEBUG] Page will STAY HERE for debugging');
    
    alert('[DEBUG] Signup complete! Check console logs. Page will NOT redirect.');
  }

  async resendOtp() {
    console.log('[DEBUG] resendOtp() called');
    try {
      const sendOtpTermii = httpsCallable(functions, 'sendOtpTermii');
      const result = await sendOtpTermii({
        phone: this.data.phone,
        firstName: this.data.firstName || "User",
        lastName: this.data.lastName || ""
      });
      
      this.data.pinId = result.data.pin_id;
      sessionStorage.setItem('signupData', JSON.stringify(this.data));
      console.log('[DEBUG] New OTP sent, pinId:', this.data.pinId);
      alert("New OTP sent!");
      
    } catch (error) {
      console.error('[DEBUG] Resend error:', error);
      alert("Failed to resend OTP: " + error.message);
    }
  }
}

console.log('[DEBUG] Creating VerifyOtpManager instance...');
new VerifyOtpManager();
console.log('[DEBUG] VerifyOtpManager created');
