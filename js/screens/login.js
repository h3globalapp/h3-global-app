// js/screens/login.js
import { auth, db, functions } from '../firebase-config.js';
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js ";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js ";
import { collection, query, where, getDocs, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js ";

class LoginManager {
  constructor() {
    this.phoneNumber = '';
    this.userData = null;
    this.userExists = false;
    this.isLegacyFirebaseUser = false;
    this.init();
  }

  init() {
    this.setupPhoneValidation();
    document.getElementById('btnSendOTP').addEventListener('click', () => this.routeOtp());
    document.getElementById('btnVerify').addEventListener('click', () => this.verifyOtp());
  }

  setupPhoneValidation() {
    const phoneInput = document.getElementById('etPhone');
    const countrySelect = document.getElementById('countryCode');
    const btn = document.getElementById('btnSendOTP');
    
    const validate = () => {
      const phone = countrySelect.value + phoneInput.value.replace(/\D/g, '');
      const isValid = phone.length >= 10 && phone.length <= 15;
      btn.disabled = !isValid;
    };
    
    phoneInput.addEventListener('input', validate);
    countrySelect.addEventListener('change', validate);
	validate(); // <-- ADD THIS LINE
  }

  async routeOtp() {
    const countryCode = document.getElementById('countryCode').value;
    const phone = document.getElementById('etPhone').value.replace(/\D/g, '');
    this.phoneNumber = countryCode + phone;
    
    const btn = document.getElementById('btnSendOTP');
    btn.disabled = true;
    btn.textContent = "Checking...";
    
    try {
      // Step 1: Check if user exists in Firestore
      const userQuery = query(
        collection(db, "users"), 
        where("phone", "==", this.phoneNumber)
      );
      const snapshot = await getDocs(userQuery);
      
      if (snapshot.empty) {
        // No user found - redirect to signup
        this.showToast("No account found. Please sign up.", "info");
        setTimeout(() => {
          window.location.href = 'signup.html';
        }, 1500);
        return;
      }
      
      // User exists - get their data
      this.userExists = true;
      this.userData = snapshot.docs[0].data();
      const createdWith = this.userData.createdWith || "firebase";
      
      // Step 2: Determine authentication method
      if (createdWith === "firebase") {
        // LEGACY USER: Created with Firebase Phone Auth
        this.isLegacyFirebaseUser = true;
        console.log("Legacy Firebase user detected - using custom token flow");
        await this.sendOtpViaTermiiForFirebaseUser();
      } else {
        // NEW USER: Created with Termii
        this.isLegacyFirebaseUser = false;
        console.log("Termii user detected - using standard Termii flow");
        await this.sendOtpViaTermii();
      }
      
    } catch (error) {
      console.error("Route OTP error:", error);
      this.showToast("Error: " + error.message, "error");
      btn.disabled = false;
      btn.textContent = "Send OTP";
    }
  }

  /**
   * FOR LEGACY FIREBASE USERS
   * Use Termii to send OTP, then verify via backend to get Firebase Custom Token
   */
  async sendOtpViaTermiiForFirebaseUser() {
    try {
      // Send OTP via Termii (no reCAPTCHA needed!)
      const sendOtpTermii = httpsCallable(functions, 'sendOtpTermii');
      const result = await sendOtpTermii({ 
        phone: this.phoneNumber,
        // Don't need firstName/lastName for login, but Termii might require them
        firstName: this.userData.firstName || "User",
        lastName: this.userData.lastName || ""
      });
      
      const { pin_id } = result.data;
      if (!pin_id) throw new Error("Failed to send OTP");
      
      // Store for verification
      this.pinId = pin_id;
      
      // Show OTP input
      this.showOtpSection();
      this.showToast("OTP sent to your phone", "success");
      
    } catch (error) {
      console.error("Failed to send OTP:", error);
      this.showToast("Failed to send OTP: " + error.message, "error");
      document.getElementById('btnSendOTP').disabled = false;
      document.getElementById('btnSendOTP').textContent = "Send OTP";
    }
  }

  /**
   * FOR NEW TERMI USERS
   * Standard Termii flow
   */
  async sendOtpViaTermii() {
    try {
      const sendOtpTermii = httpsCallable(functions, 'sendOtpTermii');
      const result = await sendOtpTermii({ 
        phone: this.phoneNumber,
        firstName: this.userData.firstName || "User",
        lastName: this.userData.lastName || ""
      });
      
      const { pin_id } = result.data;
      if (!pin_id) throw new Error("Failed to send OTP");
      
      this.pinId = pin_id;
      this.showOtpSection();
      this.showToast("OTP sent to your phone", "success");
      
    } catch (error) {
      this.showToast("Failed to send OTP: " + error.message, "error");
      document.getElementById('btnSendOTP').disabled = false;
      document.getElementById('btnSendOTP').textContent = "Send OTP";
    }
  }

 showOtpSection() {
  // Show OTP section
  document.getElementById('otpSection').classList.remove('hidden');
  
  // Change send button to "Resend"
  document.getElementById('btnSendOTP').textContent = "Resend OTP";
  document.getElementById('btnSendOTP').disabled = false;
  
  // ENABLE the verify button (remove disabled)
  document.getElementById('btnVerify').disabled = false;
  
  // Show resend link
  document.getElementById('btnResend').classList.add('visible');
  
  // Focus on OTP input
  document.getElementById('etOTP').focus();
}

  async verifyOtp() {
    const otp = document.getElementById('etOTP').value.trim();
    if (otp.length !== 6) {
      this.showToast("Enter 6-digit OTP", "error");
      return;
    }
    
    const btn = document.getElementById('btnVerify');
    btn.disabled = true;
    btn.textContent = "Verifying...";
    
    try {
      if (this.isLegacyFirebaseUser) {
        // LEGACY: Verify via Termii, get Firebase Custom Token
        await this.verifyFirebaseUserViaTermii(otp);
      } else {
        // NEW: Standard Termii verification
        await this.verifyTermiiUser(otp);
      }
    } catch (error) {
      console.error("Verification error:", error);
      this.showToast(error.message, "error");
      btn.disabled = false;
      btn.textContent = "Verify OTP";
    }
  }

  /**
   * CRITICAL: Verify legacy Firebase user via Termii backend
   * Backend validates OTP and returns Firebase Custom Token
   */
  async verifyFirebaseUserViaTermii(otp) {
    try {
      // Call backend to verify Termii OTP AND generate Firebase Custom Token
      const verifyOtpHybrid = httpsCallable(functions, 'verifyOtpHybrid');
const result = await verifyOtpHybrid({
        phone: this.phoneNumber,
        pinId: this.pinId,
        pin: otp
      });
      
      const { token } = result.data;
      
if (!token) {
  throw new Error("Authentication failed - no token received");
}

// Sign in with Firebase Custom Token (NO reCAPTCHA!)
await signInWithCustomToken(auth, token);
      
      this.showToast("Login successful!", "success");
		window.location.href = 'index.html';      
    } catch (error) {
      throw new Error("Verification failed: " + error.message);
    }
  }

  /**
   * Standard Termii user verification
   */
  async verifyTermiiUser(otp) {
    try {
const verifyOtpHybrid = httpsCallable(functions, 'verifyOtpHybrid'); // Use new function
      const result = await verifyOtpHybrid({
        phone: this.phoneNumber,
        pinId: this.pinId,
        pin: otp
      });
      
      const { token } = result.data;
      if (!token) throw new Error("Verification failed");
      
      await signInWithCustomToken(auth, token);
      
      this.showToast("Login successful!", "success");
      window.location.href = 'index.html';
      
    } catch (error) {
      throw new Error("Verification failed: " + error.message);
    }
  }

  showToast(message, type = 'info') {
  // Non-blocking toast that auto-dismisses
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:12px 24px;border-radius:24px;z-index:1000;';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 2000);
}
  
  
}

// Pre-fill phone if coming from signup
document.addEventListener('DOMContentLoaded', () => {
  const pendingPhone = sessionStorage.getItem('pendingLoginPhone');
  if (pendingPhone) {
    const phoneInput = document.getElementById('etPhone');
    const countrySelect = document.getElementById('countryCode');
    if (phoneInput && countrySelect) {
      // Parse +2348012345678 into country code + number
      if (pendingPhone.startsWith('+')) {
        const countryCode = pendingPhone.substring(0, 4); // +234
        const number = pendingPhone.substring(4); // 8012345678
        countrySelect.value = countryCode;
        phoneInput.value = number;
      } else {
        phoneInput.value = pendingPhone;
      }
    }
    sessionStorage.removeItem('pendingLoginPhone');
  }
});

// Initialize LoginManager
document.addEventListener('DOMContentLoaded', () => {
  new LoginManager();
});