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

    if (!this.data.phone || !this.data.pinId) {
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
  }

  async verifyOtp() {
    const otp = document.getElementById('etOtp').value.trim();
    if (otp.length !== 6) {
      alert("Enter 6-digit OTP code");
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
      
      const { token, isExistingUser } = result.data;
      if (!token) throw new Error("No authentication token received");
      
      // Step 1: Sign in to Firebase Auth
      await signInWithCustomToken(auth, token);
      
      // Step 2: If signup, create user record + wallet
      if (this.data.isSignup) {
        await this.createUserRecord();
      } else {
        window.location.href = 'index.html';
      }
      
    } catch (error) {
      console.error("Verification error:", error);
      alert(error.message);
      btn.disabled = false;
      btn.textContent = 'VERIFY';
    }
  }

async createUserRecord() {
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
  
  // STEP 1: Create user in transaction (CRITICAL - must succeed)
  try {
    await runTransaction(db, async (transaction) => {
      const phoneDoc = await transaction.get(phoneRef);
      if (phoneDoc.exists()) {
        throw new Error("PHONE_ALREADY_USED");
      }
      
      transaction.set(phoneRef, { createdAt: serverTimestamp() });
      transaction.set(userRef, userMap);
      
      const noTierRoles = ['Hasher', 'Member', 'Visitor'];
      if (!noTierRoles.includes(this.data.designation)) {
        const designationPath = this.data.designation === "Admin" ? "Admin" : this.data.kennel;
        const designationRef = doc(db, "designations", designationPath);
        transaction.set(designationRef, {
          [this.data.designation]: this.data.phone
        }, { merge: true });
      }
    });
  } catch (error) {
    if (error.message === "PHONE_ALREADY_USED") {
      throw new Error("This phone number is already registered. Please login instead.");
    }
    throw error; // Re-throw other errors
  }
  
  // STEP 2: Update kennel requests (NOT critical - can fail silently)
  try {
    // FIX #1: Removed trailing space
    const { updateDoc, query, where, getDocs, collection } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    
    const requestsQuery = query(
      collection(db, 'kennelRequests'),
      where('requesterPhone', '==', this.data.phone),
      where('status', '==', 'pending')
    );
    const requestSnaps = await getDocs(requestsQuery);
    
    for (const requestDoc of requestSnaps.docs) {
      await updateDoc(requestDoc.ref, {
        requesterUid: uid,
        requesterHandle: this.data.hashHandle
      });
      
      const requestData = requestDoc.data();
      if (requestData.canonicalName) {
        // FIX #2: Removed "this." - it's a standalone function
        const tempId = tempKennelName(requestData.canonicalName);
        const tempRef = doc(db, `locations/${requestData.country}/states/${requestData.state}/kennels/${tempId}`);
        await updateDoc(tempRef, {
          requesterUid: uid,
          requesterHandle: this.data.hashHandle
        }).catch(e => console.log('Temp kennel may not exist:', e));
      }
    }
  } catch (err) {
    // Only log - don't throw, don't block signup
    console.error('Non-critical: kennel request update failed:', err);
  }
  
  // STEP 3: Only redirect after everything succeeds
  sessionStorage.removeItem('signupData');
  alert("Signup successful! Welcome to H3 Global.");
  window.location.href = 'index.html';
}
  catch (error) {
    if (error.message === "PHONE_ALREADY_USED") {
      throw new Error("This phone number is already registered. Please login instead.");
    }
    throw error;
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
      sessionStorage.setItem('signupData', JSON.stringify(this.data));
      alert("New OTP sent!");
      
    } catch (error) {
      console.error("Resend error:", error);
      alert("Failed to resend OTP: " + error.message);
    }
  }
}

new VerifyOtpManager();
