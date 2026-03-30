// js/screens/verify-otp.js
import { auth, db, functions } from '../firebase-config.js';
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

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
    
    // Try multiple sources for signup data (mobile compatibility)
    let signupData = this.getSignupData();
    
    this.data = {
      phone: signupData.phone,
      pinId: signupData.pinId,
      hashHandle: signupData.hashHandle,
      firstName: signupData.firstName,
      lastName: signupData.lastName,
      country: signupData.country,
      state: signupData.state,
      kennel: signupData.kennel,
      designation: signupData.designation,
      isFirebase: signupData.isFirebase || false,
      isSignup: signupData.isSignup || false
    };

    console.log('[DEBUG] this.data prepared:', this.data);

    if (!this.data.phone || !this.data.pinId) {
      console.error('[DEBUG] MISSING phone or pinId!');
      alert('Session expired. Please start again.');
      window.location.href = 'signup.html';
      return;
    }
    
    // Re-save to localStorage to ensure it's there for refreshes
    this.saveSignupData(this.data);
    
    this.init();
  }
  
  // Get data from localStorage, sessionStorage, or URL params
  getSignupData() {
    let data = null;
    
    // 1. Try localStorage first (most reliable on mobile)
    try {
      const ls = localStorage.getItem('signupData');
      if (ls) {
        data = JSON.parse(ls);
        console.log('[DEBUG] Data from localStorage:', data);
      }
    } catch(e) {
      console.log('[DEBUG] localStorage error:', e);
    }
    
    // 2. Fallback to sessionStorage
    if (!data) {
      try {
        const ss = sessionStorage.getItem('signupData');
        if (ss) {
          data = JSON.parse(ss);
          console.log('[DEBUG] Data from sessionStorage:', data);
        }
      } catch(e) {
        console.log('[DEBUG] sessionStorage error:', e);
      }
    }
    
    // 3. Fallback to URL parameters
    if (!data) {
      const url = new URLSearchParams(window.location.search);
      const phone = url.get('phone');
      const pinId = url.get('pinId');
      if (phone && pinId) {
        data = {
          phone: phone,
          pinId: pinId,
          hashHandle: url.get('hashHandle'),
          firstName: url.get('firstName'),
          lastName: url.get('lastName'),
          country: url.get('country'),
          state: url.get('state'),
          kennel: url.get('kennel'),
          designation: url.get('designation'),
          isSignup: true
        };
        console.log('[DEBUG] Data from URL params:', data);
      }
    }
    
    return data || {};
  }
  
  // Save to localStorage for persistence
  saveSignupData(data) {
    try {
      localStorage.setItem('signupData', JSON.stringify(data));
      console.log('[DEBUG] Saved to localStorage');
    } catch(e) {
      console.error('[DEBUG] Failed to save to localStorage:', e);
    }
  }

  init() {
    console.log('[DEBUG] init() called');
    
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
      
      const { token, isExistingUser } = result.data;
      console.log('[DEBUG] token received:', token ? 'YES' : 'NO');
      
      if (!token) {
        throw new Error("No authentication token received");
      }
      
      // Step 1: Sign in to Firebase Auth
      console.log('[DEBUG] Calling signInWithCustomToken...');
      const userCredential = await signInWithCustomToken(auth, token);
      console.log('[DEBUG] signInWithCustomToken SUCCESS');
      
      // Wait for auth state to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Step 2: If signup, create user record
      if (this.data.isSignup) {
        console.log('[DEBUG] isSignup=true, calling createUserRecord()...');
        await this.createUserRecord(userCredential.user);
        console.log('[DEBUG] createUserRecord() completed');
        
        // Clear storage and redirect
        localStorage.removeItem('signupData');
        sessionStorage.removeItem('signupData');
        alert('Account created successfully!');
        window.location.href = 'index.html';
      } else {
        console.log('[DEBUG] isSignup=false, login flow complete');
        localStorage.removeItem('signupData');
        sessionStorage.removeItem('signupData');
        window.location.href = 'index.html';
      }
      
    } catch (error) {
      console.error('[DEBUG] ===== verifyOtp() ERROR =====');
      console.error('[DEBUG] Error:', error);
      alert('Error: ' + error.message);
      btn.disabled = false;
      btn.textContent = 'VERIFY';
    }
  }

  async createUserRecord(user) {
    console.log('[DEBUG] ===== createUserRecord() STARTED =====');
    console.log('[DEBUG] User UID:', user?.uid);
    
    if (!user) {
      throw new Error("Authentication failed - no user");
    }
    
    const uid = user.uid;
    
    // Validate required data
    const required = ['phone', 'hashHandle', 'firstName', 'lastName', 'country', 'state', 'kennel', 'designation'];
    const missing = required.filter(field => !this.data[field]);
    if (missing.length > 0) {
      console.error('[DEBUG] MISSING fields:', missing);
      throw new Error(`Missing: ${missing.join(', ')}`);
    }
    
    // Create fake email from phone
    let cleanPhone = this.data.phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '234' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }
    const fakeEmail = `user${cleanPhone}@h3global.app`;
    
    // Document references
    const phoneRef = doc(db, "phoneNumbers", this.data.phone);
    const userRef = doc(db, "users", uid);
    
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
    
    try {
      // Check if phone exists
      const phoneCheck = await getDoc(phoneRef);
      if (phoneCheck.exists()) {
        throw new Error("Phone already registered. Please login.");
      }
      
      // Create documents
      await setDoc(phoneRef, { createdAt: serverTimestamp() });
      console.log('[DEBUG] Phone document created');
      
      await setDoc(userRef, userMap);
      console.log('[DEBUG] User document created');
      
      // Handle designation
      const noTierRoles = ['Hasher', 'Member', 'Visitor'];
      if (!noTierRoles.includes(this.data.designation)) {
        const designationPath = this.data.designation === "Admin" ? "Admin" : this.data.kennel;
        const designationRef = doc(db, "designations", designationPath);
        await setDoc(designationRef, {
          [this.data.designation]: this.data.phone
        }, { merge: true });
        console.log('[DEBUG] Designation created');
      }
      
      console.log('[DEBUG] ===== ALL DOCUMENTS CREATED =====');
      
    } catch (error) {
      console.error('[DEBUG] createUserRecord error:', error);
      throw error;
    }
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
      this.saveSignupData(this.data);
      
      console.log('[DEBUG] New OTP sent, pinId:', this.data.pinId);
      alert("New OTP sent!");
      
    } catch (error) {
      console.error('[DEBUG] Resend error:', error);
      alert("Failed to resend: " + error.message);
    }
  }
}

console.log('[DEBUG] Creating VerifyOtpManager...');
new VerifyOtpManager();
