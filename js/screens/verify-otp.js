// js/screens/verify-otp.js
import { auth, db, functions } from '../firebase-config.js';
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

class VerifyOtpManager {
  constructor() {
    console.log('=== VerifyOtpManager starting ===');
    
    // Get data from localStorage
    let data = null;
    try {
      const stored = localStorage.getItem('signupData');
      console.log('Raw localStorage:', stored);
      if (stored) data = JSON.parse(stored);
    } catch(e) {
      console.error('Storage read error:', e);
    }
    
    console.log('Parsed data:', data);
    
    if (!data || !data.phone || !data.pinId) {
      console.error('Missing data, redirecting');
      alert('Session expired. Please start again.');
      window.location.href = 'signup.html';
      return;
    }
    
    this.data = data;
    console.log('Data assigned:', this.data);
    
    this.init();
  }

  init() {
    console.log('init() called');
    
    const btnVerify = document.getElementById('btnVerify');
    const btnResend = document.getElementById('btnResend');
    
    if (btnVerify) {
      btnVerify.addEventListener('click', () => this.verifyOtp());
      console.log('Verify button ready');
    } else {
      console.error('btnVerify not found!');
    }
    
    if (btnResend) {
      btnResend.addEventListener('click', () => this.resendOtp());
    }
  }

  async verifyOtp() {
    console.log('=== verifyOtp() started ===');
    
    const otpInput = document.getElementById('etOtp');
    if (!otpInput) {
      console.error('OTP input not found!');
      alert('Page error - refresh');
      return;
    }
    
    const otp = otpInput.value.trim();
    console.log('OTP entered:', otp);
    
    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      alert('Please enter a valid 6-digit code');
      return;
    }
    
    const btn = document.getElementById('btnVerify');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    
    try {
      console.log('Calling verifyOtpHybrid...');
      console.log('Phone:', this.data.phone);
      console.log('PinId:', this.data.pinId);
      
      const verifyOtpHybrid = httpsCallable(functions, 'verifyOtpHybrid');
      const result = await verifyOtpHybrid({
        phone: this.data.phone,
        pinId: this.data.pinId,
        pin: otp
      });
      
      console.log('Cloud function result:', result.data);
      
      const { token, isExistingUser } = result.data;
      
      if (!token) {
        throw new Error('No authentication token received from server');
      }
      
      console.log('Signing in with custom token...');
      const userCredential = await signInWithCustomToken(auth, token);
      const user = userCredential.user;
      
      console.log('Signed in, UID:', user.uid);
      console.log('isSignup:', this.data.isSignup);
      
      // Wait for auth to fully initialize
      let retries = 0;
      while (!auth.currentUser && retries < 10) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
      }
      
      if (!auth.currentUser) {
        throw new Error('Auth state not ready after sign in');
      }
      
      console.log('Auth confirmed, currentUser:', auth.currentUser.uid);
      
      // Create user record if signup
      if (this.data.isSignup) {
        console.log('Creating user record...');
        await this.createUserRecord(user);
        console.log('User record created successfully!');
      }
      
      // Clear storage and redirect
      localStorage.removeItem('signupData');
      console.log('Redirecting to index.html');
      window.location.href = 'index.html';
      
    } catch (error) {
      console.error('=== VERIFY OTP ERROR ===');
      console.error('Error:', error);
      console.error('Code:', error.code);
      console.error('Message:', error.message);
      
      // Show detailed error
      let errorMsg = error.message;
      if (error.code === 'auth/invalid-custom-token') {
        errorMsg = 'Invalid login token. Please try again.';
      } else if (error.code === 'permission-denied') {
        errorMsg = 'Permission denied. Contact support.';
      }
      
      alert('Error: ' + errorMsg);
      btn.disabled = false;
      btn.textContent = 'VERIFY';
    }
  }

  async createUserRecord(user) {
    console.log('=== createUserRecord() started ===');
    console.log('User UID:', user.uid);
    
    const uid = user.uid;
    
    // Validate all required data is present
    const required = {
      phone: this.data.phone,
      hashHandle: this.data.hashHandle,
      firstName: this.data.firstName,
      lastName: this.data.lastName,
      country: this.data.country,
      state: this.data.state,
      kennel: this.data.kennel,
      designation: this.data.designation
    };
    
    const missing = Object.entries(required).filter(([k, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      console.error('Missing fields:', missing);
      throw new Error(`Missing required data: ${missing.join(', ')}`);
    }
    
    // Clean phone number for email
    let cleanPhone = this.data.phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '234' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }
    
    const fakeEmail = `user${cleanPhone}@h3global.app`;
    console.log('Generated email:', fakeEmail);
    
    // Document references
    const phoneRef = doc(db, 'phoneNumbers', this.data.phone);
    const userRef = doc(db, 'users', uid);
    
    console.log('Phone ref path:', phoneRef.path);
    console.log('User ref path:', userRef.path);
    
    // Check if phone already exists
    console.log('Checking if phone exists...');
    const phoneCheck = await getDoc(phoneRef);
    
    if (phoneCheck.exists()) {
      console.error('Phone already registered!');
      throw new Error('This phone number is already registered. Please login instead.');
    }
    
    console.log('Phone is new, proceeding...');
    
    // Build user data
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
      createdWith: 'termii',
      createdAt: serverTimestamp(),
      walletPending: true
    };
    
    // Add role based on designation
    if (this.data.designation === 'Admin') {
      userMap.role = 'Tier 1';
    } else if (['Grand Master', 'Hash Master', 'On Sec', 'Religious Adviser'].includes(this.data.designation)) {
      userMap.role = 'Tier 2';
    }
    
    console.log('User data prepared:', JSON.stringify(userMap, null, 2));
    
    // Create phone document first
    console.log('Creating phone document...');
    await setDoc(phoneRef, { 
      uid: uid,
      createdAt: serverTimestamp() 
    });
    console.log('Phone document created');
    
    // Create user document
    console.log('Creating user document...');
    await setDoc(userRef, userMap);
    console.log('User document created');
    
    // Create designation if needed
    const noTierRoles = ['Hasher', 'Member', 'Visitor'];
    if (!noTierRoles.includes(this.data.designation)) {
      console.log('Creating designation...');
      const designationPath = this.data.designation === 'Admin' ? 'Admin' : this.data.kennel;
      const designationRef = doc(db, 'designations', designationPath);
      
      await setDoc(designationRef, {
        [this.data.designation]: this.data.phone
      }, { merge: true });
      console.log('Designation created');
    }
    
    console.log('=== createUserRecord() completed ===');
  }

  async resendOtp() {
    console.log('Resending OTP...');
    
    try {
      const sendOtpTermii = httpsCallable(functions, 'sendOtpTermii');
      const result = await sendOtpTermii({
        phone: this.data.phone,
        firstName: this.data.firstName || 'User',
        lastName: this.data.lastName || ''
      });
      
      this.data.pinId = result.data.pin_id;
      localStorage.setItem('signupData', JSON.stringify(this.data));
      
      console.log('New pinId:', this.data.pinId);
      alert('New OTP sent to your phone!');
      
    } catch (error) {
      console.error('Resend error:', error);
      alert('Failed to resend: ' + error.message);
    }
  }
}

// Start the app
console.log('Loading VerifyOtpManager...');
new VerifyOtpManager();
