// paywall.js - Subscription Paywall System

class PaywallManager {
  constructor(userData, functions, onTierSelected) {
    this.userData = userData;
    this.functions = functions;
    this.onTierSelected = onTierSelected;
    this.currentOverlay = null;
  }

  show() {
    if (document.getElementById('paywall-dialog')) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'paywall-dialog';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:100001;font-family:sans-serif;';
    
    const balance = this.userData.walletBalance || 0;
    
    overlay.innerHTML = '<div style="background:white;width:90%;max-width:420px;border-radius:16px;overflow:hidden;"><div style="background:#FF6D00;color:white;padding:20px;text-align:center;"><h2 style="margin:0;font-size:22px;">Choose Your Plan</h2><p style="margin:8px 0 0 0;opacity:0.9;">7-day FREE trial, then auto-renew</p></div><div style="padding:20px;"><div style="background:#FFF3E0;border-radius:12px;padding:16px;margin-bottom:20px;border-left:4px solid #FF6D00;"><div style="font-size:14px;color:#333;margin-bottom:8px;"><strong>Current Wallet Balance:</strong></div><div style="font-size:24px;font-weight:bold;color:#4CAF50;">₦' + balance.toLocaleString() + '</div></div><button class="tier-btn" data-tier="monthly" style="display:flex;justify-content:space-between;align-items:center;padding:16px;border:2px solid #e0e0e0;border-radius:12px;background:white;cursor:pointer;width:100%;margin-bottom:12px;"><div style="text-align:left;"><div style="font-weight:600;font-size:16px;">Monthly</div><div style="font-size:12px;color:#666;">Billed every month</div></div><div style="font-weight:bold;color:#FF6D00;font-size:18px;">₦1,900</div></button><button class="tier-btn" data-tier="quarterly" style="display:flex;justify-content:space-between;align-items:center;padding:16px;border:2px solid #e0e0e0;border-radius:12px;background:white;cursor:pointer;width:100%;margin-bottom:12px;"><div style="text-align:left;"><div style="font-weight:600;font-size:16px;">Quarterly</div><div style="font-size:12px;color:#666;">Save ₦300 (3 months)</div></div><div><div style="font-weight:bold;color:#FF6D00;font-size:18px;">₦5,400</div></div></button><button class="tier-btn" data-tier="6months" style="display:flex;justify-content:space-between;align-items:center;padding:16px;border:2px solid #e0e0e0;border-radius:12px;background:white;cursor:pointer;width:100%;margin-bottom:12px;"><div style="text-align:left;"><div style="font-weight:600;font-size:16px;">6 Months</div><div style="font-size:12px;color:#666;">Save ₦1,200 (6 months)</div></div><div><div style="font-weight:bold;color:#FF6D00;font-size:18px;">₦10,200</div></div></button><button class="tier-btn" data-tier="yearly" style="display:flex;justify-content:space-between;align-items:center;padding:16px;border:2px solid #FF6D00;border-radius:12px;background:#FFF3E0;cursor:pointer;width:100%;margin-bottom:12px;position:relative;"><div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#4CAF50;color:white;padding:2px 12px;border-radius:12px;font-size:11px;font-weight:600;">BEST VALUE</div><div style="text-align:left;margin-top:8px;"><div style="font-weight:600;font-size:16px;">Yearly</div><div style="font-size:12px;color:#666;">Save ₦3,600 (12 months)</div></div><div><div style="font-weight:bold;color:#FF6D00;font-size:18px;">₦19,200</div></div></button><div style="margin-top:16px;text-align:center;font-size:12px;color:#666;">By selecting a plan, you agree to a 7-day free trial.<br>Your wallet will be charged when the trial ends.</div></div></div>';
    
    document.body.appendChild(overlay);
    this.currentOverlay = overlay;
    
    overlay.querySelectorAll('.tier-btn').forEach(btn => {
      btn.onclick = async (e) => {
        const tier = btn.dataset.tier;
        const amounts = { monthly: 1900, quarterly: 5400, '6months': 10200, yearly: 19200 };
        
        try {
          const selectTierFn = httpsCallable(this.functions, 'selectSubscriptionTier');
          const result = await selectTierFn({ tier: tier, amount: amounts[tier], trialDays: 7 });
          
          if (result.data.success) {
            this.close();
            if (this.onTierSelected) this.onTierSelected(tier, result.data);
            alert('✅ ' + tier + ' plan selected! 7-day trial started.');
          }
        } catch (error) {
          alert('Error: ' + error.message);
        }
      };
    });
  }

  close() {
    if (this.currentOverlay) {
      this.currentOverlay.remove();
      this.currentOverlay = null;
    }
  }
}

class WalletRequiredDialog {
  constructor(functions, onWalletCreated) {
    this.functions = functions;
    this.onWalletCreated = onWalletCreated;
  }

  show(userData) {
    if (document.getElementById('wallet-required-dialog')) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'wallet-required-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:100000;font-family:sans-serif;';
    
    overlay.innerHTML = '<div style="background:white;width:90%;max-width:400px;border-radius:16px;overflow:hidden;text-align:center;"><div style="padding:24px;"><div style="font-size:48px;margin-bottom:16px;">💳</div><h2 style="margin:0 0 12px 0;font-size:20px;">Wallet Required</h2><p style="color:#666;margin-bottom:20px;line-height:1.5;">You need to create a wallet to use the app. This wallet will be used for subscription payments and run registrations.</p><button id="btn-create-wallet" style="width:100%;padding:14px;background:#FF6D00;color:white;border:none;border-radius:8px;font-size:16px;font-weight:500;cursor:pointer;">Create Wallet</button></div></div>';
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('#btn-create-wallet').onclick = async () => {
      try {
        const createWalletFn = httpsCallable(this.functions, 'createUserWallet');
        const result = await createWalletFn({
          phone: userData.phone,
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          hashHandle: userData.hashHandle || ''
        });
        
        if (result.data.success) {
          overlay.remove();
          alert('✅ Wallet created! Account: ' + result.data.accountNumber);
          if (this.onWalletCreated) this.onWalletCreated(result.data);
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    };
  }
}

class ExpiredSubscriptionDialog {
  constructor() {
    this.currentOverlay = null;
  }

  show(userData) {
    if (document.getElementById('expired-subscription-dialog')) return;
    
    const tier = userData.subscriptionTier;
    const amount = userData.subscriptionAmount;
    const balance = userData.walletBalance || 0;
    const needed = amount - balance;
    
    const overlay = document.createElement('div');
    overlay.id = 'expired-subscription-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:100003;font-family:sans-serif;';
    
    overlay.innerHTML = '<div style="background:white;width:90%;max-width:400px;border-radius:16px;overflow:hidden;"><div style="background:#d32f2f;color:white;padding:20px;text-align:center;"><div style="font-size:48px;margin-bottom:8px;">⏰</div><h2 style="margin:0;font-size:20px;">Subscription Expired</h2></div><div style="padding:20px;"><div style="background:#ffebee;border-radius:12px;padding:16px;margin-bottom:20px;text-align:center;"><div style="font-size:14px;color:#666;margin-bottom:8px;">Amount Due:</div><div style="font-size:28px;font-weight:bold;color:#d32f2f;">₦' + amount.toLocaleString() + '</div><div style="font-size:12px;color:#666;margin-top:8px;">Current Balance: ₦' + balance.toLocaleString() + '</div></div><div style="background:#e8f5e9;border-radius:12px;padding:16px;margin-bottom:20px;"><div style="font-weight:600;margin-bottom:12px;color:#2e7d32;">Fund Your Wallet:</div><div style="font-size:14px;margin-bottom:8px;"><strong>Bank:</strong> ' + (userData.titanBankName || 'Paystack-Titan') + '</div><div style="font-size:14px;margin-bottom:8px;"><strong>Account Number:</strong> <span style="font-family:monospace;font-size:16px;letter-spacing:1px;">' + (userData.titanAccountNumber || 'N/A') + '</span></div><div style="font-size:14px;margin-bottom:12px;"><strong>Account Name:</strong> ' + (userData.titanAccountName || 'N/A') + '</div><div style="background:white;border-radius:8px;padding:12px;font-size:12px;color:#666;border:1px dashed #4CAF50;"><strong>How to fund:</strong><br>1. Transfer <strong>₦' + Math.max(needed, 1000).toLocaleString() + '</strong> or more from any bank app<br>2. Your wallet will update automatically<br>3. Subscription will renew automatically once funded</div></div><div style="font-size:12px;color:#999;text-align:center;margin-bottom:16px;">App access is blocked until subscription is renewed</div><button onclick="location.reload()" style="width:100%;padding:14px;background:#FF6D00;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer;">I\'ve Sent Money - Check Status</button></div></div>';
    
    document.body.appendChild(overlay);
    this.currentOverlay = overlay;
  }

  close() {
    if (this.currentOverlay) {
      this.currentOverlay.remove();
      this.currentOverlay = null;
    }
  }
}

// Export for use in other files
window.PaywallManager = PaywallManager;
window.WalletRequiredDialog = WalletRequiredDialog;
window.ExpiredSubscriptionDialog = ExpiredSubscriptionDialog;