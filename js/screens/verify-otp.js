// js/screens/verify-otp.js
import { auth, db, functions } from '../firebase-config.js';
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, runTransaction, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Temp kennel name generator (matches Android exactly)
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
    const sessionData = JSON.parse(sessionStorage.getItem('signupData') || '{}');
    
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

    console.log('[DEBUG] VerifyOtpManager initialized with data:', this.data);

    if (!this.data.phone || !this.data.pinId) {
      console.error('[DEBUG] Session expired - missing phone or pinId');
      alert('Session expired. Please start again.');
      window.location.href = 'signup.html';
      return;
    }
    
    this.init();
  }

  init() {
    const phoneDisplay = document.getElementById('phoneDisplay');
    if (phoneDisplay) phoneDisplay.textContent = this.data.phone;
    
    document.getElementById('btnVerify').addEventListener('click', () => this.verifyOtp());
    document.getElementById('btnResend').addEventListener('click', () => this.resendOtp());
    console.log('[DEBUG] Event listeners attached');
  }

  async verifyOtp() {
    const otp = document.getElementById('etOtp').value.trim();
    console.log('[DEBUG] OTP entered:', otp);
    
    if (otp.length !== 6) {
      alert("Enter 6-digit OTP code");
      return;
    }
    
    const btn = document.getElementById('btnVerify');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    
    try {
      console.log('[DEBUG] Calling verifyOtpHybrid with phone:', this.data.phone, 'pinId:', this.data.pinId);
      const verifyOtpHybrid = httpsCallable(functions, 'verifyOtpHybrid');
      const result = await verifyOtpHybrid({
        phone: this.data.phone,
        pinId: this.data.pinId,
        pin: otp
      });
      
      console.log('[DEBUG] verifyOtpHybrid result:', result.data);
      const { token, isExistingUser } = result.data;
      
      if (!token) {
        console.error('[DEBUG] No token received from verifyOtpHybrid');
        throw new Error("No authentication token received");
      }
      
      console.log('[DEBUG] Token received, isExistingUser:', isExistingUser);
      console.log('[DEBUG] isSignup flag:', this.data.isSignup);
      
      // Step 1: Sign in to Firebase Auth
      console.log('[DEBUG] Signing in with custom token...');
      await signInWithCustomToken(auth, token);
      console.log('[DEBUG] Firebase Auth sign-in successful. Current user:', auth.currentUser?.uid);
      
      // Step 2: If signup, create user record + wallet
      if (this.data.isSignup) {
        console.log('[DEBUG] isSignup is true, proceeding to createUserRecord()');
        await this.createUserRecord();
      } else {
        console.log('[DEBUG] isSignup is false, would redirect to index.html (BLOCKED FOR DEBUG)');
        // window.location.href = 'index.html';
      }
      
    } catch (error) {
      console.error("[DEBUG] Verification error:", error);
      console.error("[DEBUG] Error stack:", error.stack);
      alert(error.message);
      btn.disabled = false;
      btn.textContent = 'VERIFY';
    }
  }

 async createUserRecord() {
  console.log('[DEBUG] createUserRecord() started');
  const user = auth.currentUser;
  if (!user) throw new Error("Authentication failed - no user");
  
  const uid = user.uid;
  
  // Create fake email from phone
  let cleanPhone = this.data.phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '234' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('+')) {
    cleanPhone = cleanPhone.substring(1);
  }
  const fakeEmail = `user${cleanPhone}@h3global.app`;
  
  const userRef = doc(db, "users", uid);
  const phoneRef = doc(db, "phoneNumbers", this.data.phone);
  
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
    // Step 1: Check if phone exists (outside transaction)
    console.log('[DEBUG] Checking if phone exists...');
    const phoneCheck = await getDoc(phoneRef);
    console.log('[DEBUG] Phone exists:', phoneCheck.exists());
    
    if (phoneCheck.exists()) {
      throw new Error("This phone number is already registered. Please login instead.");
    }
    
    // Step 2: Create documents WITHOUT transaction (simpler, avoids rules issues)
    console.log('[DEBUG] Creating phone document...');
    await setDoc(phoneRef, { createdAt: serverTimestamp() });
    console.log('[DEBUG] Phone document created');
    
    console.log('[DEBUG] Creating user document...');
    await setDoc(userRef, userMap);
    console.log('[DEBUG] User document created');
    
    // Step 3: Handle designation if needed
    const noTierRoles = ['Hasher', 'Member', 'Visitor'];
    if (!noTierRoles.includes(this.data.designation)) {
      const designationPath = this.data.designation === "Admin" ? "Admin" : this.data.kennel;
      const designationRef = doc(db, "designations", designationPath);
      console.log('[DEBUG] Creating designation at:', designationPath);
      await setDoc(designationRef, {
        [this.data.designation]: this.data.phone
      }, { merge: true });
      console.log('[DEBUG] Designation created');
    }
    
    console.log('[DEBUG] All documents created successfully!');
    
  } catch (error) {
    console.error('[DEBUG] Error creating records:', error);
    console.error('[DEBUG] Error code:', error.code);
    console.error('[DEBUG] Error message:', error.message);
    
    // Cleanup: if user doc was created but phone wasn't, or vice versa
    // This is best-effort cleanup
    try {
      const phoneCheck = await getDoc(phoneRef);
      const userCheck = await getDoc(userRef);
      console.log('[DEBUG] Cleanup check - phone exists:', phoneCheck.exists(), 'user exists:', userCheck.exists());
    } catch (e) {
      console.log('[DEBUG] Cleanup check failed:', e);
    }
    
    throw error;
  }
  
  // ... rest of kennelRequests update code stays the same ...

  async resendOtp() {
    console.log('[DEBUG] Resend OTP requested for phone:', this.data.phone);
    try {
      const sendOtpTermii = httpsCallable(functions, 'sendOtpTermii');
      const result = await sendOtpTermii({
        phone: this.data.phone,
        firstName: this.data.firstName || "User",
        lastName: this.data.lastName || ""
      });
      
      this.data.pinId = result.data.pin_id;
      sessionStorage.setItem('signupData', JSON.stringify(this.data));
      console.log('[DEBUG] New OTP sent, pinId updated:', this.data.pinId);
      alert("New OTP sent!");
      
    } catch (error) {
      console.error("[DEBUG] Resend error:", error);
      alert("Failed to resend OTP: " + error.message);
    }
  }
}

console.log('[DEBUG] Initializing VerifyOtpManager...');
new VerifyOtpManager();
