// js/screens/verify-otp.js
import { auth, db, functions } from '../firebase-config.js';
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

class VerifyOtpManager {
  constructor() {
    // Get data from localStorage only
    let data = null;
    try {
      const stored = localStorage.getItem('signupData');
      if (stored) data = JSON.parse(stored);
    } catch(e) {
      console.error('Storage error:', e);
    }
    
    if (!data || !data.phone || !data.pinId) {
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
    const otp = document.getElementById('etOtp').value.trim();
    if (otp.length !== 6) {
      alert("Enter 6-digit OTP");
      return;
    }
    
    const btn = document.getElementById('btnVerify');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    
    try {
      const verifyOtpHybrid = httpsCallable(functions, 'verifyOtpHybrid');
      const result = await verifyOtpHybrid({
        phone: this.data.phone,
        pinId: this.data.pinId,
        pin: otp
      });
      
      if (!result.data.token) throw new Error('No token received');
      
      const userCred = await signInWithCustomToken(auth, result.data.token);
      
      // Small delay for auth to settle
      await new Promise(r => setTimeout(r, 500));
      
      if (this.data.isSignup) {
        await this.createUserRecord(userCred.user);
      }
      
      // Clear and redirect
      localStorage.removeItem('signupData');
      window.location.href = 'index.html';
      
    } catch (error) {
      alert('Error: ' + error.message);
      btn.disabled = false;
      btn.textContent = 'VERIFY';
    }
  }

  async createUserRecord(user) {
    const uid = user.uid;
    
    // Clean phone for email
    let cleanPhone = this.data.phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '234' + cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
    
    const phoneRef = doc(db, "phoneNumbers", this.data.phone);
    const userRef = doc(db, "users", uid);
    
    // Check phone doesn't exist
    const phoneCheck = await getDoc(phoneRef);
    if (phoneCheck.exists()) {
      throw new Error("Phone already registered");
    }
    
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
    
    // Create documents
    await setDoc(phoneRef, { createdAt: serverTimestamp() });
    await setDoc(userRef, userMap);
    
    // Handle designation
    const noTierRoles = ['Hasher', 'Member', 'Visitor'];
    if (!noTierRoles.includes(this.data.designation)) {
      const desigPath = this.data.designation === "Admin" ? "Admin" : this.data.kennel;
      const desigRef = doc(db, "designations", desigPath);
      await setDoc(desigRef, { [this.data.designation]: this.data.phone }, { merge: true });
    }
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
      localStorage.setItem('signupData', JSON.stringify(this.data));
      alert("New OTP sent!");
    } catch (error) {
      alert("Failed to resend: " + error.message);
    }
  }
}

new VerifyOtpManager();
