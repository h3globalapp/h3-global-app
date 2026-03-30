// js/screens/verify-otp.js
import { auth, db, functions } from '../firebase-config.js';
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

class VerifyOtpManager {
  constructor() {
    console.log('=== VERIFY OTP INITIALIZED ===');
    console.log('User Agent:', navigator.userAgent);
    console.log('localStorage available:', !!window.localStorage);
    console.log('sessionStorage available:', !!window.sessionStorage);
    
    let data = null;
    let storageError = null;
    
    // Try localStorage first
    try {
      const stored = localStorage.getItem('signupData');
      console.log('Raw localStorage:', stored);
      if (stored) data = JSON.parse(stored);
    } catch(e) {
      storageError = e;
      console.error('localStorage error:', e);
    }
    
    // Fallback to sessionStorage
    if (!data) {
      try {
        const stored = sessionStorage.getItem('signupData');
        console.log('Raw sessionStorage:', stored);
        if (stored) data = JSON.parse(stored);
      } catch(e) {
        console.error('sessionStorage error:', e);
      }
    }
    
    console.log('Parsed data:', data);
    console.log('Data valid:', !!(data && data.phone && data.pinId));
    
    if (!data || !data.phone || !data.pinId) {
      console.error('REDIRECTING: Invalid session data. Storage error:', storageError);
      alert('Session expired. Please start again.');
      window.location.href = 'signup.html';
      return;
    }
    
    this.data = data;
    this.init();
  }

  init() {
    const btn = document.getElementById('btnVerify');
    const btnResend = document.getElementById('btnResend');
    
    if (btn) btn.addEventListener('click', () => this.verifyOtp());
    if (btnResend) btnResend.addEventListener('click', () => this.resendOtp());
  }

  async verifyOtp() {
    console.log('=== VERIFY OTP STARTED ===');
    
    const otp = document.getElementById('etOtp').value.trim();
    if (otp.length !== 6) {
      alert("Enter 6-digit OTP");
      return;
    }
    
    // Check if functions is available
    if (!functions) {
      console.error('Firebase Functions not initialized! Check firebase-config.js export');
      alert('System error: Functions not loaded. Please refresh the page.');
      return;
    }
    console.log('functions object available:', !!functions);
    console.log('auth object available:', !!auth);
    
    const btn = document.getElementById('btnVerify');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    
    try {
      console.log('Creating httpsCallable for verifyOtpHybrid...');
      const verifyOtpHybrid = httpsCallable(functions, 'verifyOtpHybrid');
      
      console.log('Calling verifyOtpHybrid with:', {
        phone: this.data.phone,
        pinId: this.data.pinId,
        pin: otp
      });
      
      const result = await verifyOtpHybrid({
        phone: this.data.phone,
        pinId: this.data.pinId,
        pin: otp
      });
      
      console.log('OTP verification result:', result.data);
      
      if (!result.data.token) {
        throw new Error('No token received from server');
      }
      
      console.log('Signing in with custom token...');
      const userCred = await signInWithCustomToken(auth, result.data.token);
      console.log('User credential received:', userCred);
      console.log('User object:', userCred.user);
      console.log('User UID:', userCred.user?.uid);
      
      // Wait for auth state to be ready (mobile fix)
      console.log('Waiting for auth state to settle...');
      await new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds total
        
        const checkAuth = setInterval(() => {
          attempts++;
          const currentUser = auth.currentUser;
          console.log(`Auth check attempt ${attempts}:`, currentUser?.uid);
          
          if (currentUser && currentUser.uid) {
            clearInterval(checkAuth);
            resolve(currentUser);
          } else if (attempts >= maxAttempts) {
            clearInterval(checkAuth);
            reject(new Error('Auth state timeout - user not ready after 5s'));
          }
        }, 100);
      });
      
      console.log('Auth state confirmed, currentUser:', auth.currentUser?.uid);
      
      if (this.data.isSignup) {
        console.log('isSignup=true, creating user record...');
        await this.createUserRecord(auth.currentUser);
        console.log('User record created successfully!');
      } else {
        console.log('isSignup=false, skipping user record creation');
      }
      
      // Clear storage and redirect
      console.log('Clearing storage and redirecting...');
      try {
        localStorage.removeItem('signupData');
        sessionStorage.removeItem('signupData');
      } catch(e) {
        console.log('Storage clear error (non-critical):', e);
      }
      
      window.location.href = 'index.html';
      
    } catch (error) {
      console.error('=== VERIFY OTP ERROR ===');
      console.error('Error type:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Full error object:', error);
      
      alert('Error: ' + error.message);
      btn.disabled = false;
      btn.textContent = 'VERIFY';
    }
  }

  async createUserRecord(user) {
    console.log('=== CREATE USER RECORD STARTED ===');
    console.log('User parameter:', user);
    
    if (!user || !user.uid) {
      throw new Error('Invalid user object passed to createUserRecord');
    }
    
    const uid = user.uid;
    console.log('Creating user record for UID:', uid);
    
    // Clean phone for email
    let cleanPhone = this.data.phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '234' + cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
    
    console.log('Clean phone for email:', cleanPhone);
    
    const phoneRef = doc(db, "phoneNumbers", this.data.phone);
    const userRef = doc(db, "users", uid);
    
    console.log('Checking if phone already exists...');
    // Check phone doesn't exist
    const phoneCheck = await getDoc(phoneRef);
    if (phoneCheck.exists()) {
      console.error('Phone already registered:', this.data.phone);
      throw new Error("Phone already registered");
    }
    console.log('Phone number is new, proceeding...');
    
    const userMap = {
      hashHandle: this.data.hashHandle,
      hashHandleLower: this.data.hashHandle.toLowerCase(),
      firstName: this.data.firstName,
      lastName: this.data.lastName,
      phone: this.data.phone,
      email: `user${cleanPhone}@h3global.app`,
      country: this.data.country,
      state: this.data.state,
      kennel: this.data.kennel,
      designation: this.data.designation,
      createdWith: "termii",
      createdAt: serverTimestamp(),
      walletPending: true
    };
    
    if (this.data.designation === "Admin") userMap.role = "Tier 1";
    else if (["Grand Master", "Hash Master", "On Sec", "Religious Adviser"].includes(this.data.designation)) {
      userMap.role = "Tier 2";
    }
    
    console.log('User data to save:', userMap);
    
    // Create documents with individual error handling
    try {
      console.log('Creating phoneNumbers document...');
      await setDoc(phoneRef, { createdAt: serverTimestamp() });
      console.log('phoneNumbers document created successfully');
    } catch (err) {
      console.error('FAILED to create phoneNumbers document:', err);
      throw new Error('Failed to create phone record: ' + err.message);
    }
    
    try {
      console.log('Creating users document...');
      await setDoc(userRef, userMap);
      console.log('users document created successfully');
    } catch (err) {
      console.error('FAILED to create users document:', err);
      throw new Error('Failed to create user record: ' + err.message);
    }
    
    // Handle designation
    const noTierRoles = ['Hasher', 'Member', 'Visitor'];
    if (!noTierRoles.includes(this.data.designation)) {
      const desigPath = this.data.designation === "Admin" ? "Admin" : this.data.kennel;
      const desigRef = doc(db, "designations", desigPath);
      console.log('Creating designation record at:', desigPath);
      
      try {
        await setDoc(desigRef, { [this.data.designation]: this.data.phone }, { merge: true });
        console.log('Designation record created successfully');
      } catch (err) {
        console.error('FAILED to create designation document:', err);
        // Non-critical, don't throw
      }
    }
    
    console.log('=== CREATE USER RECORD COMPLETED ===');
  }

  async resendOtp() {
    try {
      const sendOtpTermii = httpsCallable(functions, 'sendOtpTermii');
      const result = await sendOtpTermii({
        phone: this.data.phone,
        firstName: this.data.firstName || "User",
        lastName: this.data.lastName || ""
      });
      
      this.data.pinId = result.data.pin_id;
      
      // Save to both storages
      try {
        localStorage.setItem('signupData', JSON.stringify(this.data));
      } catch(e) {
        console.log('localStorage save error:', e);
      }
      try {
        sessionStorage.setItem('signupData', JSON.stringify(this.data));
      } catch(e) {
        console.log('sessionStorage save error:', e);
      }
      
      alert("New OTP sent!");
    } catch (error) {
      console.error('Resend OTP error:', error);
      alert("Failed to resend: " + error.message);
    }
  }
}

new VerifyOtpManager();
