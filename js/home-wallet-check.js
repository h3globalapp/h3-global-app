import { auth, db, functions } from './firebase-config.js';
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

class WalletCheckManager {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.isRetry = false;
    this.init();
  }

  init() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser = user;
        await this.checkWallet();
      } else {
        window.location.href = 'login.html';
      }
    });
  }

  async checkWallet() {
    try {
      const userRef = doc(db, "users", this.currentUser.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        console.error("User document not found");
        return;
      }

      this.userData = userSnap.data();
      
      // Only for Nigeria users
      if (this.userData.country !== 'Nigeria') {
        console.log("Non-Nigeria user, skipping wallet");
        return;
      }

      // Check if wallet exists
      const hasWallet = this.userData.paystackCustomerId && this.userData.titanAccountNumber;
      
      if (!hasWallet) {
        // Mandatory wallet creation for Nigeria users
        this.showWalletDialog(this.userData.walletPending === true);
      }
      
    } catch (error) {
      console.error("Error checking wallet:", error);
    }
  }

  showWalletDialog(isRetry = false) {
    if (document.getElementById('walletDialog')) return;
    this.isRetry = isRetry;

    const hasName = this.userData.firstName && this.userData.lastName;
    
    const dialogHTML = `
      <div id="walletDialog" class="wallet-modal">
        <div class="wallet-modal-content">
          <h2>${isRetry ? 'Complete Wallet Setup' : 'Create Your H3 Wallet'}</h2>
          <p>${isRetry ? 'Your previous attempt failed. Please try again.' : 'Create your wallet to pay for Hash runs and events securely.'}</p>
          
          ${!hasName ? `
            <div class="wallet-input-group">
              <label>First Name</label>
              <input type="text" id="walletFirstName" placeholder="Enter your first name" required>
            </div>
            <div class="wallet-input-group">
              <label>Last Name</label>
              <input type="text" id="walletLastName" placeholder="Enter your last name" required>
            </div>
          ` : `
            <p class="user-name">Creating wallet for: <strong>${this.userData.firstName} ${this.userData.lastName}</strong></p>
          `}
          
          <div class="wallet-info">
            <small>Powered by Paystack</small>
          </div>
          
          <button id="btnCreateWallet" class="wallet-btn">
            ${isRetry ? 'Retry Create Wallet' : 'Create Wallet'}
          </button>
          
          <p class="wallet-mandatory-text">Wallet creation is required for Nigeria users</p>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', dialogHTML);
    this.addStyles();
    
    document.getElementById('btnCreateWallet').addEventListener('click', () => this.createWallet());
  }

  async createWallet() {
    const btn = document.getElementById('btnCreateWallet');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    let firstName = this.userData.firstName;
    let lastName = this.userData.lastName;
    
    if (!firstName || !lastName) {
      firstName = document.getElementById('walletFirstName').value.trim();
      lastName = document.getElementById('walletLastName').value.trim();
      
      if (!firstName || !lastName) {
        alert("Please enter both first name and last name");
        btn.disabled = false;
        btn.textContent = this.isRetry ? 'Retry Create Wallet' : 'Create Wallet';
        return;
      }
    }

    try {
      const createWalletFn = httpsCallable(functions, 'createUserWallet');
      
      console.log("Creating Titan wallet for:", { 
        phone: this.userData.phone, 
        firstName, 
        lastName,
        hashHandle: this.userData.hashHandle 
      });
      
      const result = await createWalletFn({
        phone: this.userData.phone,
        firstName: firstName,
        lastName: lastName,
        hashHandle: this.userData.hashHandle
      });

      console.log("Wallet created:", result.data);
      
      const { accountNumber, bankName, accountName } = result.data;
      
      alert(`✅ Wallet created successfully!\n\nAccount: ${accountNumber}\nBank: ${bankName}\nName: ${accountName}`);
      this.closeDialog();
      
      // Reload to show updated state
      setTimeout(() => window.location.reload(), 500);
      
    } catch (error) {
      console.error("Error creating wallet:", error);
      
      const errorMessage = error.message || "Unknown error";
      
      // Update user doc with error
      await updateDoc(doc(db, "users", this.currentUser.uid), {
        walletError: errorMessage,
        walletPending: true,
        walletErrorAt: new Date()
      });
      
      alert("❌ Failed to create wallet: " + errorMessage);
      btn.disabled = false;
      btn.textContent = 'Retry Create Wallet';
    }
  }

  closeDialog() {
    const dialog = document.getElementById('walletDialog');
    if (dialog) dialog.remove();
  }

  addStyles() {
    if (document.getElementById('walletStyles')) return;
    
    const styles = `
      <style id="walletStyles">
        .wallet-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.8);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        .wallet-modal-content {
          background: white;
          padding: 24px;
          border-radius: 12px;
          width: 90%;
          max-width: 400px;
          text-align: center;
        }
        .wallet-modal-content h2 {
          margin-top: 0;
          color: #333;
        }
        .wallet-input-group {
          margin: 16px 0;
          text-align: left;
        }
        .wallet-input-group label {
          display: block;
          margin-bottom: 4px;
          font-weight: bold;
          color: #555;
        }
        .wallet-input-group input {
          width: 100%;
          padding: 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          box-sizing: border-box;
        }
        .user-name {
          background: #f0f0f0;
          padding: 12px;
          border-radius: 6px;
          margin: 16px 0;
        }
        .wallet-info {
          margin: 12px 0;
          color: #666;
        }
        .wallet-btn {
          width: 100%;
          padding: 14px;
          background: #00C853;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 16px;
          cursor: pointer;
          margin-top: 12px;
        }
        .wallet-btn:disabled {
          background: #ccc;
        }
        .wallet-mandatory-text {
          color: #999;
          font-size: 12px;
          margin-top: 12px;
          font-style: italic;
        }
      </style>
    `;
    document.head.insertAdjacentHTML('beforeend', styles);
  }
}

new WalletCheckManager();