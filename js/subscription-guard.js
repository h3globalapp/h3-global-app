import { auth, db, functions } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

class SubscriptionGuard {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.unsubscribe = null;
    this.selectedTier = null;
    this.init();
  }

  init() {
    const cachedUser = sessionStorage.getItem('cachedUser');
    if (cachedUser) {
      const userData = JSON.parse(cachedUser);
      this.currentUser = { uid: userData.uid };
    }

    onAuthStateChanged(auth, (user) => {
      if (user) {
        this.currentUser = user;
        sessionStorage.setItem('lastAuthTime', Date.now().toString());
        sessionStorage.setItem('cachedUser', JSON.stringify({
          uid: user.uid,
          email: user.email
        }));
        this.loadUserData(user.uid);
      } else {
        sessionStorage.removeItem('lastAuthTime');
        sessionStorage.removeItem('cachedUser');
        window.location.href = 'login.html';
      }
    });
  }

async loadUserData(uid) {
  const cachedKey = `userData_${uid}`;
  const cachedData = sessionStorage.getItem(cachedKey);
  
  // FIX: Define userRef at the top, before any use
  const userRef = doc(db, 'users', uid);
  
  // Only use cache to show loading/blocking, not to allow access
  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      this.userData = parsed;
      const status = this.checkStatus();
      
      // Only act on cache if it says BLOCKED - never use cache to allow access
      if (status.blocked) {
        this.showBlockingOverlay(status.reason);
        // Continue to set up real-time listener for fresh data
      }
      // If cache says "not blocked", don't remove overlay - wait for real-time
    } catch (e) {
      console.error('Cache parse error:', e);
    }
  }

  // Now userRef is properly defined when we use it here
  this.unsubscribe = onSnapshot(userRef, (snapshot) => {
    if (!snapshot.exists()) {
      window.location.href = 'signup.html';
      return;
    }

    this.userData = snapshot.data();
    sessionStorage.setItem(cachedKey, JSON.stringify(this.userData));
    
    const status = this.checkStatus();
    if (status.blocked) {
      this.showBlockingOverlay(status.reason);
    } else {
      this.removeBlockingOverlay();
    }
  }, (error) => {
    console.error('Guard error:', error);
    if (error.code === 'permission-denied') {
      window.location.href = 'login.html';
    }
    // On other errors, show loading/blocking if not already blocked
    else if (!document.getElementById('subscription-overlay')) {
      this.showBlockingOverlay('loading');
    }
  });
}

checkStatus() {
  if (!this.userData) return { blocked: true, reason: 'loading' };

  const {
    titanAccountNumber,
    subscriptionTier,
    subscriptionStatus,
    trialEndsAt,
    subscriptionExpiresAt
  } = this.userData;

  if (!titanAccountNumber) {
    return { blocked: true, reason: 'no-wallet' };
  }

  if (!subscriptionTier) {
    return { blocked: true, reason: 'no-tier' };
  }

  // NEW: Treat missing/invalid status as expired
  const validStatuses = ['trial', 'active'];
  if (!validStatuses.includes(subscriptionStatus)) {
    return { blocked: true, reason: 'expired' };
  }

  const now = new Date();

  if (subscriptionStatus === 'trial') {
    const trialEnd = trialEndsAt?.toDate ? trialEndsAt.toDate() : null;
    if (!trialEnd || trialEnd <= now) {
      return { blocked: true, reason: 'expired' };
    }
    return { blocked: false };
  }

  if (subscriptionStatus === 'active') {
    const expires = subscriptionExpiresAt?.toDate ? subscriptionExpiresAt.toDate() : null;
    // FIX: Missing expiration = EXPIRED, not allowed
    if (!expires || expires <= now) {
      return { blocked: true, reason: 'expired' };
    }
    return { blocked: false };
  }

  return { blocked: true, reason: 'expired' };
}

showBlockingOverlay(reason) {
  // Don't create duplicate overlays
  if (document.getElementById('subscription-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'subscription-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.75);
    backdrop-filter: blur(4px);
    z-index: 999998;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  document.body.appendChild(overlay);
  
  // ADD THIS: Show loading spinner for 'loading' reason
  if (reason === 'loading') {
    overlay.innerHTML = `
      <div style="
        color: white;
        font-family: sans-serif;
        text-align: center;
      ">
        <div style="
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255,255,255,0.3);
          border-top-color: #FF6D00;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        "></div>
        <div>Loading your subscription...</div>
      </div>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    `;
  } else {
    this.showAppropriateDialog(reason);
  }
}

  removeBlockingOverlay() {
    const overlay = document.getElementById('subscription-overlay');
    if (overlay) overlay.remove();
    
    const dialogs = ['wallet-required-dialog', 'paywall-dialog', 'expired-subscription-dialog'];
    dialogs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  showAppropriateDialog(reason) {
    switch(reason) {
      case 'no-wallet':
        this.showWalletRequiredDialog();
        break;
      case 'no-tier':
        this.showPaywallDialog();
        break;
      case 'expired':
        this.showExpiredDialog();
        break;
    }
  }

  showWalletRequiredDialog() {
    if (document.getElementById('wallet-required-dialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'wallet-required-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90%;
      max-width: 400px;
      background: white;
      border-radius: 16px;
      z-index: 999999;
      font-family: sans-serif;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    `;
    
    dialog.innerHTML = `
      <div style="padding: 24px; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 16px;">💳</div>
        <h2 style="margin: 0 0 12px 0; font-size: 20px;">Wallet Required</h2>
        <p style="color: #666; margin-bottom: 20px; line-height: 1.5;">
          You need to create a wallet to access this feature.
        </p>
        <button id="btn-create-wallet" style="
          width: 100%;
          padding: 14px;
          background: #FF6D00;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          margin-bottom: 12px;
        ">Create Wallet</button>
        <button id="btn-cancel-wallet" style="
          width: 100%;
          padding: 14px;
          background: #f5f5f5;
          color: #666;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
        ">Cancel</button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    dialog.querySelector('#btn-create-wallet').onclick = () => this.createWallet();
    dialog.querySelector('#btn-cancel-wallet').onclick = () => {
      window.location.href = 'index.html';
    };
  }

  async createWallet() {
    const btn = document.querySelector('#btn-create-wallet');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      const createWalletFn = httpsCallable(functions, 'createUserWallet');
      const result = await createWalletFn({
        phone: this.userData.phone,
        firstName: this.userData.firstName || '',
        lastName: this.userData.lastName || '',
        hashHandle: this.userData.hashHandle || ''
      });

      if (result.data.success) {
        // Listener will update and remove dialog
        alert('✅ Wallet created! Account: ' + result.data.accountNumber);
      }
    } catch (error) {
      alert('Error: ' + error.message);
      btn.disabled = false;
      btn.textContent = 'Create Wallet';
    }
  }

  showPaywallDialog() {
    if (document.getElementById('paywall-dialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'paywall-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90%;
      max-width: 420px;
      max-height: 85vh;
      background: white;
      border-radius: 16px;
      z-index: 999999;
      font-family: sans-serif;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;
    
    const balance = this.userData?.walletBalance || 0;
    
    dialog.innerHTML = `
      <div style="background: #FF6D00; color: white; padding: 20px; text-align: center; flex-shrink: 0;">
        <h2 style="margin: 0; font-size: 22px;">Choose Your Plan</h2>
        <p style="margin: 8px 0 0 0; opacity: 0.9;">7-day FREE trial, then auto-renew</p>
      </div>
      
      <div style="padding: 20px; overflow-y: auto;">
        <div style="background: #FFF3E0; border-radius: 12px; padding: 16px; margin-bottom: 20px; border-left: 4px solid #FF6D00;">
          <div style="font-size: 14px; color: #333; margin-bottom: 8px;">
            <strong>Wallet Balance:</strong>
          </div>
          <div style="font-size: 24px; font-weight: bold; color: #4CAF50;">
            ₦${balance.toLocaleString()}
          </div>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
          <label class="tier-option" style="
            display: flex;
            align-items: center;
            padding: 16px;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">
            <input type="radio" name="tier" value="monthly" data-amount="1900" style="width: 20px; height: 20px; margin-right: 12px;">
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 16px;">Monthly</div>
              <div style="font-size: 12px; color: #666;">₦1,900/month</div>
            </div>
            <div style="font-weight: bold; color: #FF6D00; font-size: 18px;">₦1,900</div>
          </label>
          
          <label class="tier-option" style="
            display: flex;
            align-items: center;
            padding: 16px;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">
            <input type="radio" name="tier" value="quarterly" data-amount="5400" style="width: 20px; height: 20px; margin-right: 12px;">
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 16px;">Quarterly</div>
              <div style="font-size: 12px; color: #666;">Save ₦300 (3 months)</div>
            </div>
            <div style="font-weight: bold; color: #FF6D00; font-size: 18px;">₦5,400</div>
          </label>
          
          <label class="tier-option" style="
            display: flex;
            align-items: center;
            padding: 16px;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">
            <input type="radio" name="tier" value="6months" data-amount="10200" style="width: 20px; height: 20px; margin-right: 12px;">
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 16px;">6 Months</div>
              <div style="font-size: 12px; color: #666;">Save ₦1,200 (6 months)</div>
            </div>
            <div style="font-weight: bold; color: #FF6D00; font-size: 18px;">₦10,200</div>
          </label>
          
          <label class="tier-option" style="
            display: flex;
            align-items: center;
            padding: 16px;
            border: 2px solid #FF6D00;
            border-radius: 12px;
            cursor: pointer;
            background: #FFF3E0;
            position: relative;
            transition: all 0.2s;
          ">
            <div style="
              position: absolute;
              top: -10px;
              left: 50%;
              transform: translateX(-50%);
              background: #4CAF50;
              color: white;
              padding: 2px 12px;
              border-radius: 12px;
              font-size: 11px;
              font-weight: 600;
            ">BEST VALUE</div>
            <input type="radio" name="tier" value="yearly" data-amount="19200" style="width: 20px; height: 20px; margin-right: 12px; margin-top: 8px;">
            <div style="flex: 1; margin-top: 8px;">
              <div style="font-weight: 600; font-size: 16px;">Yearly</div>
              <div style="font-size: 12px; color: #666;">Save ₦3,600 (12 months)</div>
            </div>
            <div style="font-weight: bold; color: #FF6D00; font-size: 18px; margin-top: 8px;">₦19,200</div>
          </label>
        </div>
        
        <div style="font-size: 12px; color: #999; text-align: center; margin-bottom: 16px;">
          By selecting a plan, you agree to a 7-day free trial.<br>
          Your wallet will be charged when the trial ends.
        </div>
      </div>
      
      <div style="padding: 20px; border-top: 1px solid #e0e0e0; flex-shrink: 0;">
        <button id="btn-confirm-tier" disabled style="
          width: 100%;
          padding: 14px;
          background: #ccc;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: not-allowed;
          margin-bottom: 12px;
          transition: all 0.2s;
        ">Confirm Selection</button>
        <button id="btn-cancel-tier" style="
          width: 100%;
          padding: 14px;
          background: #f5f5f5;
          color: #666;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
        ">Cancel</button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Radio button change handler
    const radios = dialog.querySelectorAll('input[name="tier"]');
    const confirmBtn = dialog.querySelector('#btn-confirm-tier');
    const options = dialog.querySelectorAll('.tier-option');
    
    radios.forEach((radio, index) => {
      radio.onchange = () => {
        this.selectedTier = {
          tier: radio.value,
          amount: parseInt(radio.dataset.amount)
        };
        
        // Enable confirm button
        confirmBtn.disabled = false;
        confirmBtn.style.background = '#FF6D00';
        confirmBtn.style.cursor = 'pointer';
        
        // Highlight selected
        options.forEach((opt, i) => {
          if (i === index) {
            opt.style.borderColor = '#FF6D00';
            opt.style.background = '#FFF3E0';
          } else {
            opt.style.borderColor = '#e0e0e0';
            opt.style.background = 'white';
          }
        });
      };
    });
    
    // Hover effects
    options.forEach(opt => {
      opt.onmouseenter = () => {
        if (!opt.querySelector('input').checked) {
          opt.style.borderColor = '#ccc';
        }
      };
      opt.onmouseleave = () => {
        if (!opt.querySelector('input').checked) {
          opt.style.borderColor = '#e0e0e0';
        }
      };
    });
    
    confirmBtn.onclick = () => this.confirmTierSelection();
    dialog.querySelector('#btn-cancel-tier').onclick = () => {
      window.location.href = 'index.html';
    };
  }

  async confirmTierSelection() {
    if (!this.selectedTier) return;
    
    const confirmBtn = document.querySelector('#btn-confirm-tier');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processing...';
    
    try {
      const selectTierFn = httpsCallable(functions, 'selectSubscriptionTier');
      const result = await selectTierFn({
        tier: this.selectedTier.tier,
        amount: this.selectedTier.amount,
        trialDays: 7
      });
      
      if (result.data.success) {
        // Dialog and overlay will be removed by the listener when status updates
        alert('✅ ' + this.selectedTier.tier + ' plan selected! 7-day trial started.');
      }
    } catch (error) {
      alert('Error: ' + error.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Selection';
    }
  }

  showExpiredDialog() {
    if (document.getElementById('expired-subscription-dialog')) return;

    const tier = this.userData?.subscriptionTier;
    const amount = this.userData?.subscriptionAmount;
    const balance = this.userData?.walletBalance || 0;
    const needed = (amount || 0) - balance;
    const hasEnough = balance >= (amount || 0);

    const dialog = document.createElement('div');
    dialog.id = 'expired-subscription-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90%;
      max-width: 400px;
      background: white;
      border-radius: 16px;
      z-index: 999999;
      font-family: sans-serif;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    `;
    
    // DIFFERENT UI BASED ON WALLET BALANCE
    if (hasEnough) {
      // USER HAS ENOUGH MONEY — SHOW RENEW NOW
      dialog.innerHTML = `
        <div style="background: #d32f2f; color: white; padding: 20px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 8px;">⏰</div>
          <h2 style="margin: 0; font-size: 20px;">Subscription Expired</h2>
        </div>
        <div style="padding: 20px;">
          <div style="background: #e8f5e9; border-radius: 12px; padding: 16px; margin-bottom: 20px; text-align: center; border-left: 4px solid #4CAF50;">
            <div style="font-size: 14px; color: #2e7d32; margin-bottom: 8px;">
              <strong>✅ Wallet Balance Sufficient</strong>
            </div>
            <div style="font-size: 14px; color: #666; margin-bottom: 4px;">
              Balance: <strong>₦${balance.toLocaleString()}</strong>
            </div>
            <div style="font-size: 14px; color: #666;">
              Renewal Amount: <strong>₦${(amount || 0).toLocaleString()}</strong>
            </div>
          </div>
          
          <p style="color: #666; text-align: center; margin-bottom: 20px; line-height: 1.5;">
            Your wallet has enough funds to renew your <strong>${tier || 'subscription'}</strong> plan immediately.
          </p>
          
          <button id="btn-renew-now" style="
            width: 100%;
            padding: 14px;
            background: #FF6D00;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-bottom: 12px;
          ">Renew Subscription Now</button>
          
          <button id="btn-cancel-expired" style="
            width: 100%;
            padding: 14px;
            background: #f5f5f5;
            color: #666;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
          ">Cancel</button>
        </div>
      `;
    } else {
      // USER NEEDS MORE MONEY — SHOW BANK TRANSFER UI (ORIGINAL)
      dialog.innerHTML = `
        <div style="background: #d32f2f; color: white; padding: 20px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 8px;">⏰</div>
          <h2 style="margin: 0; font-size: 20px;">Subscription Expired</h2>
        </div>
        <div style="padding: 20px;">
          <div style="background: #ffebee; border-radius: 12px; padding: 16px; margin-bottom: 20px; text-align: center;">
            <div style="font-size: 14px; color: #666; margin-bottom: 8px;">Amount Due:</div>
            <div style="font-size: 28px; font-weight: bold; color: #d32f2f;">
              ₦${(amount || 0).toLocaleString()}
            </div>
            <div style="font-size: 12px; color: #666; margin-top: 8px;">
              Balance: ₦${balance.toLocaleString()} • Need: ₦${Math.max(needed, 0).toLocaleString()} more
            </div>
          </div>
          
          <div style="background: #e8f5e9; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
            <div style="font-weight: 600; margin-bottom: 12px; color: #2e7d32;">
              Fund Your Wallet:
            </div>
            <div style="font-size: 14px; margin-bottom: 8px;">
              <strong>Bank:</strong> ${this.userData?.titanBankName || 'Paystack-Titan'}
            </div>
            <div style="font-size: 14px; margin-bottom: 8px;">
              <strong>Account:</strong> 
              <span style="font-family: monospace;">
                ${this.userData?.titanAccountNumber || 'N/A'}
              </span>
            </div>
            <div style="background: white; border-radius: 8px; padding: 12px; font-size: 12px; color: #666; border: 1px dashed #4CAF50;">
              Transfer <strong>₦${Math.max(needed, 1000).toLocaleString()}</strong> or more to renew
            </div>
          </div>
          
          <button id="btn-check-status" style="
            width: 100%;
            padding: 14px;
            background: #FF6D00;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            margin-bottom: 12px;
          ">I've Sent Money - Check Status</button>
          
          <button id="btn-cancel-expired" style="
            width: 100%;
            padding: 14px;
            background: #f5f5f5;
            color: #666;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
          ">Cancel</button>
        </div>
      `;
    }
    
    document.body.appendChild(dialog);
    
    // ATTACH EVENT LISTENERS BASED ON WHICH UI WAS SHOWN
    if (hasEnough) {
      dialog.querySelector('#btn-renew-now').onclick = () => this.attemptRenewal();
    } else {
      dialog.querySelector('#btn-check-status').onclick = () => this.attemptRenewal();
    }
    
    dialog.querySelector('#btn-cancel-expired').onclick = () => {
      window.location.href = 'index.html';
    };
  }

  async attemptRenewal() {
    // DEBUG: Log everything
    console.log('=== attemptRenewal() STARTED ===');
    console.log('functions imported?', typeof functions);
    console.log('functions._url?', functions?._url || 'no _url property');

    const dialog = document.getElementById('expired-subscription-dialog');
    const btn = dialog?.querySelector('#btn-renew-now') 
             || dialog?.querySelector('#btn-check-status');
    
    if (!btn) {
      console.error('Button not found in dialog');
      alert('Error: Button missing. Refresh the page.');
      return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Checking...';

    try {
      // Verify functions is available
      if (!functions) {
        throw new Error('Firebase Functions not initialized. Check firebase-config.js');
      }

      console.log('Creating httpsCallable...');
      const deductFn = httpsCallable(functions, 'deductSubscriptionPayment');
      console.log('Calling function...');

      // Call with explicit timeout handling
      const result = await deductFn({});
      
      console.log('Function returned:', result);
      console.log('Result data:', result.data);

      if (result.data?.success) {
        alert('✅ Subscription renewed!');
        this.removeBlockingOverlay();
      } else if (result.data?.insufficientFunds) {
        alert(`❌ Insufficient funds. Need ₦${result.data.required}, have ₦${result.data.balance}`);
        btn.disabled = false;
        btn.textContent = originalText;
      } else {
        alert('⚠️ ' + (result.data?.message || 'Renewal failed. Try again.'));
        btn.disabled = false;
        btn.textContent = originalText;
      }
      
    } catch (error) {
      console.error('=== FULL ERROR ===');
      console.error('Error object:', error);
      console.error('Error code:', error?.code);
      console.error('Error message:', error?.message);
      console.error('Error details:', error?.details);
      
      // ALWAYS re-enable button
      btn.disabled = false;
      btn.textContent = originalText;

      // User-friendly messages based on error type
      const msg = error?.message || 'Unknown error';
      const code = error?.code || 'unknown';
      
      if (code === 'unauthenticated') {
        alert('❌ Session expired. Please log in again.');
        window.location.href = 'login.html';
      } else if (code === 'not-found') {
        alert('❌ Account not found. Contact support.');
      } else if (code === 'internal') {
        alert('❌ Server error: ' + msg);
      } else if (msg.includes('network') || msg.includes('fetch')) {
        alert('❌ Network error. Check your connection and try again.');
      } else {
        alert('❌ Error (' + code + '): ' + msg);
      }
    }
  }

  cleanup() {
    if (this.unsubscribe) this.unsubscribe();
  }
}

// Initialize immediately
const guard = new SubscriptionGuard();

window.addEventListener('beforeunload', () => {
  guard.cleanup();
});
