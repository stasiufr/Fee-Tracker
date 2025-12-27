/**
 * WebSocket Real-time Fee Tracker
 * Monitors vault balances in real-time via Solana WebSocket subscriptions
 * Compatible with asdf-validator architecture
 *
 * RELIABILITY: Includes automatic reconnection with exponential backoff,
 * heartbeat monitoring, and state recovery after disconnection
 *
 * DUAL-TRACK: Supports both vault PDA (legacy) and creator wallet (current) fee models
 */

import { Connection, PublicKey, AccountChangeCallback } from "@solana/web3.js";
import { getHeliusRpcUrl, NETWORK_INFO, getTransactionHistory } from "./helius";
import { PoHChainManager, type PoHRecord } from "./proof-of-history";
import {
  type FeeModel,
  type FeeSourceType,
  detectFeeModel,
} from "./fee-source";

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

// Extended to support dual-track: BC (vault), AMM (vault), WALLET (creator)
export type VaultType = "BC" | "AMM" | "WALLET";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface BalanceChange {
  vault: VaultType;
  vaultAddress: string;
  previousBalance: bigint;
  newBalance: bigint;
  change: bigint;
  timestamp: Date;
  slot: number;
  sourceType?: FeeSourceType; // "vault" or "wallet"
}

export interface FeeDetectedEvent {
  tokenMint: string;
  tokenSymbol?: string;
  eventType: "collect" | "burn" | "withdraw";
  vault: VaultType;
  amountLamports: bigint;
  signature?: string;
  slot: number;
  timestamp: Date;
  pohRecord?: PoHRecord;
  recoveredFromGap?: boolean; // True if this event was recovered after reconnection
  sourceType?: FeeSourceType; // "vault" or "wallet" for dual-track
  feeModel?: FeeModel; // Detected fee model
}

export interface ReconnectConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  gapRecoveryEnabled: boolean;
  maxGapRecoverySignatures: number;
}

export interface DualTrackOptions {
  enabled: boolean;
  autoDetect: boolean; // Auto-detect fee model on start
  trackVault: boolean; // Track vault PDA
  trackWallet: boolean; // Track creator wallet
  preferredSource?: FeeSourceType; // Which source to prefer for deduplication
}

export interface TrackerConfig {
  tokenMint: string;
  tokenSymbol?: string;
  bcVault: string; // Bonding Curve vault (can be auto-derived)
  ammVault?: string; // AMM vault (after migration)
  creatorWallet: string;
  rpcUrl?: string;
  enablePoH?: boolean;
  reconnect?: Partial<ReconnectConfig>;
  dualTrack?: Partial<DualTrackOptions>; // Dual-track configuration
  onFeeDetected?: (event: FeeDetectedEvent) => void;
  onBalanceChange?: (change: BalanceChange) => void;
  onError?: (error: Error) => void;
  onConnectionStateChange?: (state: ConnectionState, info?: string) => void;
  onReconnect?: (attempt: number, recoveredEvents: number) => void;
  onFeeModelDetected?: (model: FeeModel) => void; // Callback when fee model is detected
}

const DEFAULT_DUAL_TRACK_OPTIONS: DualTrackOptions = {
  enabled: true,
  autoDetect: true,
  trackVault: true,
  trackWallet: true,
  preferredSource: "vault",
};

export interface TrackerStats {
  isRunning: boolean;
  connectionState: ConnectionState;
  bcBalance: bigint;
  ammBalance: bigint;
  walletBalance: bigint; // Creator wallet balance (dual-track)
  lastSlotSeen: number;
  lastEventTime: Date | null;
  reconnectAttempts: number;
  totalReconnects: number;
  eventsRecovered: number;
  uptime: number; // ms since start
  pohState?: { lastSequence: number; lastHash: string };
  // Dual-track stats
  feeModel?: FeeModel;
  dualTrackEnabled: boolean;
  sourcesTracked: VaultType[];
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxRetries: 10,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  jitterFactor: 0.3,
  heartbeatIntervalMs: 30000, // Check connection every 30s
  heartbeatTimeoutMs: 10000,  // Consider dead if no response in 10s
  gapRecoveryEnabled: true,
  maxGapRecoverySignatures: 50,
};

// =============================================================================
// WEBSOCKET TRACKER CLASS
// =============================================================================

/**
 * Real-time WebSocket tracker for a single token
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat monitoring to detect stale connections
 * - Gap recovery to fetch missed events during disconnection
 * - State preservation across reconnections
 * - Dual-track: monitors both vault PDA and creator wallet
 */
export class WebSocketTracker {
  private config: TrackerConfig;
  private reconnectConfig: ReconnectConfig;
  private dualTrackConfig: DualTrackOptions;
  private connection: Connection;
  private rpcUrl: string;
  private wsUrl: string;

  // Subscription state
  private bcSubscriptionId: number | null = null;
  private ammSubscriptionId: number | null = null;
  private walletSubscriptionId: number | null = null; // Dual-track: creator wallet
  private bcBalance: bigint = BigInt(0);
  private ammBalance: bigint = BigInt(0);
  private walletBalance: bigint = BigInt(0); // Dual-track: creator wallet balance
  private pohManager: PoHChainManager | null = null;

  // Dual-track state
  private detectedFeeModel: FeeModel = "unknown";
  private sourcesTracked: VaultType[] = [];
  private recentSignatures: Set<string> = new Set(); // Deduplication

  // Connection state
  private connectionState: ConnectionState = "disconnected";
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private totalReconnects: number = 0;
  private eventsRecovered: number = 0;
  private startTime: Date | null = null;

  // Tracking state for gap recovery
  private lastSlotSeen: number = 0;
  private lastEventTime: Date | null = null;
  private lastSignatureSeen: Map<string, string> = new Map(); // vault -> signature

  // Heartbeat
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeatResponse: Date | null = null;

  // Reconnection
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isReconnecting: boolean = false;

  constructor(config: TrackerConfig) {
    this.config = config;
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...config.reconnect };
    this.dualTrackConfig = { ...DEFAULT_DUAL_TRACK_OPTIONS, ...config.dualTrack };

    // Setup RPC URL
    this.rpcUrl = config.rpcUrl || getHeliusRpcUrl();
    this.wsUrl = this.rpcUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");

    // Create initial connection
    this.connection = this.createConnection();

    // Initialize PoH manager if enabled
    if (config.enablePoH !== false) {
      this.pohManager = new PoHChainManager(config.tokenMint);
    }
  }

  /**
   * Create a new Connection instance
   */
  private createConnection(): Connection {
    return new Connection(this.rpcUrl, {
      wsEndpoint: this.wsUrl,
      commitment: "confirmed",
    });
  }

  /**
   * Start tracking with automatic reconnection
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("[WebSocket] Tracker already running");
      return;
    }

    this.startTime = new Date();
    this.isRunning = true;

    console.log("=".repeat(60));
    console.log(`[WebSocket] Starting tracker for ${this.config.tokenSymbol || this.config.tokenMint}`);
    console.log(`[WebSocket] Network: ${NETWORK_INFO.cluster}`);
    console.log(`[WebSocket] Reconnect enabled: maxRetries=${this.reconnectConfig.maxRetries}`);
    console.log(`[WebSocket] Heartbeat interval: ${this.reconnectConfig.heartbeatIntervalMs}ms`);
    console.log(`[WebSocket] Dual-track: ${this.dualTrackConfig.enabled ? "enabled" : "disabled"}`);
    console.log("=".repeat(60));

    // Detect fee model if dual-track is enabled with auto-detect
    if (this.dualTrackConfig.enabled && this.dualTrackConfig.autoDetect) {
      await this.detectAndConfigureFeeModel();
    } else {
      // Default sources based on config
      this.sourcesTracked = ["BC"];
      if (this.config.ammVault) {
        this.sourcesTracked.push("AMM");
      }
      if (this.dualTrackConfig.enabled && this.dualTrackConfig.trackWallet) {
        this.sourcesTracked.push("WALLET");
      }
    }

    console.log(`[WebSocket] Tracking sources: ${this.sourcesTracked.join(", ")}`);

    // Initialize PoH chain if enabled
    if (this.pohManager) {
      await this.pohManager.initialize();
      const state = this.pohManager.getState();
      console.log(`[WebSocket] PoH chain loaded: ${state.lastSequence} records`);
    }

    // Connect
    await this.connect();

    // Start heartbeat monitoring
    this.startHeartbeat();
  }

  /**
   * Detect fee model and configure sources to track
   */
  private async detectAndConfigureFeeModel(): Promise<void> {
    console.log("[WebSocket] Auto-detecting fee model...");

    try {
      const detection = await detectFeeModel(
        this.config.tokenMint,
        this.config.creatorWallet,
        this.connection
      );

      this.detectedFeeModel = detection.model;

      console.log(`[WebSocket] Detected fee model: ${detection.model}`);
      console.log(`[WebSocket] ${detection.recommendation}`);

      // Configure sources based on detected model
      this.sourcesTracked = [];

      switch (detection.model) {
        case "vault_pda":
          // Legacy model: only track vault
          if (this.dualTrackConfig.trackVault) {
            this.sourcesTracked.push("BC");
          }
          break;

        case "creator_wallet":
          // Current model: only track wallet
          if (this.dualTrackConfig.trackWallet) {
            this.sourcesTracked.push("WALLET");
          }
          break;

        case "hybrid":
        case "unknown":
        default:
          // Track both
          if (this.dualTrackConfig.trackVault) {
            this.sourcesTracked.push("BC");
          }
          if (this.dualTrackConfig.trackWallet) {
            this.sourcesTracked.push("WALLET");
          }
          break;
      }

      // Always include AMM if configured
      if (this.config.ammVault && this.dualTrackConfig.trackVault) {
        this.sourcesTracked.push("AMM");
      }

      // Notify callback
      this.config.onFeeModelDetected?.(detection.model);

    } catch (error) {
      console.warn("[WebSocket] Fee model detection failed, defaulting to hybrid:", error);
      this.detectedFeeModel = "hybrid";

      // Default to tracking both
      this.sourcesTracked = ["BC"];
      if (this.dualTrackConfig.trackWallet) {
        this.sourcesTracked.push("WALLET");
      }
      if (this.config.ammVault) {
        this.sourcesTracked.push("AMM");
      }
    }
  }

  /**
   * Stop tracking and cleanup
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log("[WebSocket] Stopping tracker...");

    this.isRunning = false;
    this.stopHeartbeat();
    this.clearReconnectTimeout();

    await this.disconnect();

    this.setConnectionState("disconnected");
    console.log("[WebSocket] Tracker stopped");
  }

  /**
   * Connect and subscribe to vaults and/or wallet based on detected sources
   */
  private async connect(): Promise<void> {
    this.setConnectionState("connecting");

    try {
      // Create fresh connection
      this.connection = this.createConnection();

      // Fetch initial balances for tracked sources
      await this.fetchInitialBalances();

      // Subscribe based on tracked sources
      if (this.sourcesTracked.includes("BC")) {
        await this.subscribeToBCVault();
      }

      if (this.sourcesTracked.includes("AMM") && this.config.ammVault) {
        await this.subscribeToAMMVault();
      }

      if (this.sourcesTracked.includes("WALLET")) {
        await this.subscribeToCreatorWallet();
      }

      // Mark as connected
      this.setConnectionState("connected");
      this.reconnectAttempts = 0;
      this.lastHeartbeatResponse = new Date();

      const sourceCount = this.sourcesTracked.length;
      console.log(`[WebSocket] Connected and subscribed to ${sourceCount} source(s)`);

    } catch (error) {
      console.error("[WebSocket] Connection failed:", error);
      this.setConnectionState("disconnected");
      this.config.onError?.(error as Error);

      // Trigger reconnection
      if (this.isRunning) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Disconnect and cleanup all subscriptions
   */
  private async disconnect(): Promise<void> {
    try {
      if (this.bcSubscriptionId !== null) {
        await this.connection.removeAccountChangeListener(this.bcSubscriptionId);
        this.bcSubscriptionId = null;
      }

      if (this.ammSubscriptionId !== null) {
        await this.connection.removeAccountChangeListener(this.ammSubscriptionId);
        this.ammSubscriptionId = null;
      }

      if (this.walletSubscriptionId !== null) {
        await this.connection.removeAccountChangeListener(this.walletSubscriptionId);
        this.walletSubscriptionId = null;
      }
    } catch (error) {
      // Ignore errors during disconnect
      console.warn("[WebSocket] Error during disconnect:", error);
    }

    // Clear deduplication cache
    this.recentSignatures.clear();
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting || !this.isRunning) return;

    if (this.reconnectAttempts >= this.reconnectConfig.maxRetries) {
      console.error(`[WebSocket] Max reconnection attempts (${this.reconnectConfig.maxRetries}) reached`);
      this.config.onError?.(new Error("Max reconnection attempts reached"));
      return;
    }

    this.isReconnecting = true;
    this.setConnectionState("reconnecting");

    // Calculate delay with exponential backoff and jitter
    const baseDelay = this.reconnectConfig.baseDelayMs * Math.pow(2, this.reconnectAttempts);
    const cappedDelay = Math.min(baseDelay, this.reconnectConfig.maxDelayMs);
    const jitter = this.reconnectConfig.jitterFactor * (Math.random() * 2 - 1);
    const delay = Math.floor(cappedDelay * (1 + jitter));

    this.reconnectAttempts++;

    console.log(
      `[WebSocket] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.reconnectConfig.maxRetries} ` +
      `in ${delay}ms...`
    );

    this.reconnectTimeout = setTimeout(async () => {
      this.isReconnecting = false;

      if (!this.isRunning) return;

      // Record state before reconnect for gap recovery
      const lastSlot = this.lastSlotSeen;
      const lastSignatures = new Map(this.lastSignatureSeen);

      // Disconnect existing subscriptions
      await this.disconnect();

      // Reconnect
      await this.connect();

      // If connected, try gap recovery
      if (this.connectionState === "connected" && this.reconnectConfig.gapRecoveryEnabled) {
        const recovered = await this.recoverMissedEvents(lastSlot, lastSignatures);
        this.eventsRecovered += recovered;
        this.totalReconnects++;

        console.log(`[WebSocket] Reconnected (attempt ${this.reconnectAttempts}), recovered ${recovered} events`);
        this.config.onReconnect?.(this.reconnectAttempts, recovered);
      }

    }, delay);
  }

  /**
   * Clear any pending reconnection timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(async () => {
      if (!this.isRunning || this.connectionState !== "connected") return;

      try {
        // Use getSlot as a heartbeat ping
        const startTime = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.reconnectConfig.heartbeatTimeoutMs
        );

        await this.connection.getSlot();
        clearTimeout(timeoutId);

        const latency = Date.now() - startTime;
        this.lastHeartbeatResponse = new Date();

        // Log occasionally
        if (Math.random() < 0.1) { // 10% of heartbeats
          console.log(`[WebSocket] Heartbeat OK (${latency}ms)`);
        }

      } catch (error) {
        console.warn("[WebSocket] Heartbeat failed:", error);

        // Check if connection is stale
        const timeSinceLastResponse = this.lastHeartbeatResponse
          ? Date.now() - this.lastHeartbeatResponse.getTime()
          : Infinity;

        if (timeSinceLastResponse > this.reconnectConfig.heartbeatTimeoutMs * 2) {
          console.error("[WebSocket] Connection appears dead, triggering reconnect");
          this.scheduleReconnect();
        }
      }
    }, this.reconnectConfig.heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Recover events that may have been missed during disconnection
   */
  private async recoverMissedEvents(
    lastSlot: number,
    lastSignatures: Map<string, string>
  ): Promise<number> {
    if (!this.reconnectConfig.gapRecoveryEnabled) return 0;

    console.log(`[WebSocket] Attempting gap recovery from slot ${lastSlot}...`);

    let recoveredCount = 0;

    try {
      // Recover BC vault events
      const bcRecovered = await this.recoverVaultEvents(
        this.config.bcVault,
        "BC",
        lastSignatures.get(this.config.bcVault)
      );
      recoveredCount += bcRecovered;

      // Recover AMM vault events if applicable
      if (this.config.ammVault) {
        const ammRecovered = await this.recoverVaultEvents(
          this.config.ammVault,
          "AMM",
          lastSignatures.get(this.config.ammVault)
        );
        recoveredCount += ammRecovered;
      }

    } catch (error) {
      console.error("[WebSocket] Gap recovery failed:", error);
    }

    return recoveredCount;
  }

  /**
   * Recover events for a specific vault
   */
  private async recoverVaultEvents(
    vaultAddress: string,
    vaultType: VaultType,
    lastSignature?: string
  ): Promise<number> {
    try {
      // Fetch recent signatures
      const signatures = await getTransactionHistory(vaultAddress, {
        limit: this.reconnectConfig.maxGapRecoverySignatures,
      });

      if (!signatures || signatures.length === 0) return 0;

      // Find where we left off
      let newSignatures = signatures;
      if (lastSignature) {
        const lastIndex = signatures.findIndex(s => s.signature === lastSignature);
        if (lastIndex > 0) {
          newSignatures = signatures.slice(0, lastIndex);
        } else if (lastIndex === 0) {
          // No new signatures
          return 0;
        }
        // If lastIndex === -1, we may have missed more than maxGapRecoverySignatures
      }

      console.log(`[WebSocket] Found ${newSignatures.length} new signatures for ${vaultType} vault`);

      // Process each missed signature
      for (const sig of newSignatures.reverse()) { // Process oldest first
        // Emit as recovered event
        const event: FeeDetectedEvent = {
          tokenMint: this.config.tokenMint,
          tokenSymbol: this.config.tokenSymbol,
          eventType: "withdraw", // Will be corrected by classifier
          vault: vaultType,
          amountLamports: BigInt(0), // Unknown without parsing
          signature: sig.signature,
          slot: sig.slot,
          timestamp: sig.blockTime ? new Date(sig.blockTime * 1000) : new Date(),
          recoveredFromGap: true,
        };

        this.config.onFeeDetected?.(event);
      }

      // Update last seen signature
      if (newSignatures.length > 0) {
        this.lastSignatureSeen.set(vaultAddress, newSignatures[0].signature);
      }

      return newSignatures.length;

    } catch (error) {
      console.error(`[WebSocket] Error recovering ${vaultType} vault events:`, error);
      return 0;
    }
  }

  /**
   * Set connection state and notify listeners
   */
  private setConnectionState(state: ConnectionState, info?: string): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      console.log(`[WebSocket] Connection state: ${state}${info ? ` (${info})` : ""}`);
      this.config.onConnectionStateChange?.(state, info);
    }
  }

  /**
   * Fetch initial balances for all tracked sources
   */
  private async fetchInitialBalances(): Promise<void> {
    try {
      // Fetch BC vault balance if tracked
      if (this.sourcesTracked.includes("BC")) {
        const bcPubkey = new PublicKey(this.config.bcVault);
        const bcInfo = await this.connection.getAccountInfo(bcPubkey);
        this.bcBalance = BigInt(bcInfo?.lamports || 0);
        console.log(`[WebSocket] BC Vault balance: ${this.bcBalance} lamports`);

        // Fetch last signature for gap recovery
        const bcSigs = await this.connection.getSignaturesForAddress(bcPubkey, { limit: 1 });
        if (bcSigs[0]) {
          this.lastSignatureSeen.set(this.config.bcVault, bcSigs[0].signature);
          this.lastSlotSeen = Math.max(this.lastSlotSeen, bcSigs[0].slot);
        }
      }

      // Fetch AMM vault balance if tracked
      if (this.sourcesTracked.includes("AMM") && this.config.ammVault) {
        const ammPubkey = new PublicKey(this.config.ammVault);
        const ammInfo = await this.connection.getAccountInfo(ammPubkey);
        this.ammBalance = BigInt(ammInfo?.lamports || 0);
        console.log(`[WebSocket] AMM Vault balance: ${this.ammBalance} lamports`);

        // Fetch last signature for gap recovery
        const ammSigs = await this.connection.getSignaturesForAddress(ammPubkey, { limit: 1 });
        if (ammSigs[0]) {
          this.lastSignatureSeen.set(this.config.ammVault, ammSigs[0].signature);
          this.lastSlotSeen = Math.max(this.lastSlotSeen, ammSigs[0].slot);
        }
      }

      // Fetch creator wallet balance if tracked (dual-track)
      if (this.sourcesTracked.includes("WALLET")) {
        const walletPubkey = new PublicKey(this.config.creatorWallet);
        const walletInfo = await this.connection.getAccountInfo(walletPubkey);
        this.walletBalance = BigInt(walletInfo?.lamports || 0);
        console.log(`[WebSocket] Creator Wallet balance: ${this.walletBalance} lamports`);

        // Fetch last signature for gap recovery
        const walletSigs = await this.connection.getSignaturesForAddress(walletPubkey, { limit: 1 });
        if (walletSigs[0]) {
          this.lastSignatureSeen.set(this.config.creatorWallet, walletSigs[0].signature);
          this.lastSlotSeen = Math.max(this.lastSlotSeen, walletSigs[0].slot);
        }
      }
    } catch (error) {
      console.error("[WebSocket] Error fetching initial balances:", error);
      throw error;
    }
  }

  /**
   * Subscribe to Bonding Curve vault changes
   */
  private async subscribeToBCVault(): Promise<void> {
    const pubkey = new PublicKey(this.config.bcVault);

    const callback: AccountChangeCallback = (accountInfo, context) => {
      this.handleAccountChange("BC", pubkey.toBase58(), accountInfo.lamports, context.slot);
    };

    this.bcSubscriptionId = this.connection.onAccountChange(pubkey, callback, "confirmed");
    console.log(`[WebSocket] Subscribed to BC vault: ${this.config.bcVault.slice(0, 8)}...`);
  }

  /**
   * Subscribe to AMM vault changes
   */
  private async subscribeToAMMVault(): Promise<void> {
    if (!this.config.ammVault) return;

    const pubkey = new PublicKey(this.config.ammVault);

    const callback: AccountChangeCallback = (accountInfo, context) => {
      this.handleAccountChange("AMM", pubkey.toBase58(), accountInfo.lamports, context.slot);
    };

    this.ammSubscriptionId = this.connection.onAccountChange(pubkey, callback, "confirmed");
    console.log(`[WebSocket] Subscribed to AMM vault: ${this.config.ammVault.slice(0, 8)}...`);
  }

  /**
   * Subscribe to creator wallet changes (dual-track)
   */
  private async subscribeToCreatorWallet(): Promise<void> {
    if (!this.config.creatorWallet) return;

    const pubkey = new PublicKey(this.config.creatorWallet);

    const callback: AccountChangeCallback = (accountInfo, context) => {
      this.handleAccountChange("WALLET", pubkey.toBase58(), accountInfo.lamports, context.slot);
    };

    this.walletSubscriptionId = this.connection.onAccountChange(pubkey, callback, "confirmed");
    console.log(`[WebSocket] Subscribed to Creator Wallet: ${this.config.creatorWallet.slice(0, 8)}...`);
  }

  /**
   * Handle account balance change for any source type
   */
  private async handleAccountChange(
    vault: VaultType,
    vaultAddress: string,
    newLamports: number,
    slot: number
  ): Promise<void> {
    // Update tracking state
    this.lastSlotSeen = Math.max(this.lastSlotSeen, slot);
    this.lastEventTime = new Date();
    this.lastHeartbeatResponse = new Date(); // Account change = connection alive

    // Get previous balance based on source type
    let previousBalance: bigint;
    if (vault === "BC") {
      previousBalance = this.bcBalance;
    } else if (vault === "AMM") {
      previousBalance = this.ammBalance;
    } else {
      previousBalance = this.walletBalance;
    }

    const newBalance = BigInt(newLamports);
    const change = newBalance - previousBalance;

    // Update stored balance
    if (vault === "BC") {
      this.bcBalance = newBalance;
    } else if (vault === "AMM") {
      this.ammBalance = newBalance;
    } else {
      this.walletBalance = newBalance;
    }

    // Ignore zero changes
    if (change === BigInt(0)) return;

    // Determine source type for dual-track
    const sourceType: FeeSourceType = vault === "WALLET" ? "wallet" : "vault";

    const balanceChange: BalanceChange = {
      vault,
      vaultAddress,
      previousBalance,
      newBalance,
      change,
      timestamp: new Date(),
      slot,
      sourceType,
    };

    // Notify balance change
    this.config.onBalanceChange?.(balanceChange);

    // Classify the event based on source type
    const eventType = this.classifyBalanceChange(change, vault);

    // Fetch transaction signature (async, best effort)
    const signature = await this.fetchRecentSignature(vaultAddress);

    // Deduplication for dual-track
    if (signature && this.recentSignatures.has(signature)) {
      console.log(`[WebSocket] Skipping duplicate event: ${signature.slice(0, 8)}...`);
      return;
    }

    // Add to deduplication set (keep last 100)
    if (signature) {
      this.recentSignatures.add(signature);
      if (this.recentSignatures.size > 100) {
        const oldest = this.recentSignatures.values().next().value as string;
        if (oldest) {
          this.recentSignatures.delete(oldest);
        }
      }
      this.lastSignatureSeen.set(vaultAddress, signature);
    }

    // Create fee detected event
    const feeEvent: FeeDetectedEvent = {
      tokenMint: this.config.tokenMint,
      tokenSymbol: this.config.tokenSymbol,
      eventType,
      vault,
      amountLamports: change > 0 ? change : -change,
      signature: signature || undefined,
      slot,
      sourceType,
      feeModel: this.detectedFeeModel,
      timestamp: new Date(),
    };

    // Add to PoH chain if enabled
    if (this.pohManager && signature) {
      try {
        // Map WALLET to UNKNOWN for PoH compatibility
        const pohVault: "BC" | "AMM" | "UNKNOWN" = vault === "WALLET" ? "UNKNOWN" : vault;

        const pohRecord = await this.pohManager.addEvent({
          eventType,
          vault: pohVault,
          amountLamports: feeEvent.amountLamports,
          signature,
          tokenSymbol: this.config.tokenSymbol,
          slot,
        });
        feeEvent.pohRecord = pohRecord;
      } catch (error) {
        console.error("[WebSocket] Error adding PoH record:", error);
      }
    }

    // Notify fee detected
    this.config.onFeeDetected?.(feeEvent);

    console.log(
      `[WebSocket] [${vault}] ${eventType.toUpperCase()}: ${feeEvent.amountLamports} lamports (slot ${slot})`
    );
  }

  /**
   * Classify balance change as collect, burn, or withdraw
   * For WALLET source, incoming SOL could be fee collection from pump.fun
   */
  private classifyBalanceChange(change: bigint, _vault?: VaultType): "collect" | "burn" | "withdraw" {
    if (change > 0) {
      // Positive change = SOL coming in
      return "collect";
    }

    // Negative change = SOL leaving
    // For wallet, outgoing could be personal tx or burn
    // For vault, outgoing is typically withdraw or burn
    // We default to "withdraw" - classifier will correct if it's a burn
    return "withdraw";
  }

  /**
   * Fetch the most recent transaction signature for the vault
   */
  private async fetchRecentSignature(vaultAddress: string): Promise<string | null> {
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(vaultAddress),
        { limit: 1 }
      );
      return signatures[0]?.signature || null;
    } catch {
      return null;
    }
  }

  /**
   * Get comprehensive tracker statistics
   */
  getStats(): TrackerStats {
    return {
      isRunning: this.isRunning,
      connectionState: this.connectionState,
      bcBalance: this.bcBalance,
      ammBalance: this.ammBalance,
      walletBalance: this.walletBalance,
      lastSlotSeen: this.lastSlotSeen,
      lastEventTime: this.lastEventTime,
      reconnectAttempts: this.reconnectAttempts,
      totalReconnects: this.totalReconnects,
      eventsRecovered: this.eventsRecovered,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      pohState: this.pohManager?.getState(),
      feeModel: this.detectedFeeModel,
      dualTrackEnabled: this.dualTrackConfig.enabled,
      sourcesTracked: this.sourcesTracked,
    };
  }

  /**
   * Get current state (backward compatible)
   */
  getState(): {
    isRunning: boolean;
    bcBalance: bigint;
    ammBalance: bigint;
    pohState?: { lastSequence: number; lastHash: string };
  } {
    return {
      isRunning: this.isRunning,
      bcBalance: this.bcBalance,
      ammBalance: this.ammBalance,
      pohState: this.pohManager?.getState(),
    };
  }

  /**
   * Verify PoH chain integrity
   */
  async verifyPoHChain(): Promise<{
    valid: boolean;
    chainLength: number;
    invalidAt?: number;
    error?: string;
  }> {
    if (!this.pohManager) {
      return { valid: true, chainLength: 0, error: "PoH not enabled" };
    }
    return this.pohManager.verifyFullChain();
  }

  /**
   * Force a reconnection (useful for testing or manual recovery)
   */
  async forceReconnect(): Promise<void> {
    if (!this.isRunning) {
      console.warn("[WebSocket] Cannot force reconnect - tracker not running");
      return;
    }

    console.log("[WebSocket] Forcing reconnection...");
    this.clearReconnectTimeout();
    await this.disconnect();
    this.scheduleReconnect();
  }

  /**
   * Check if connection is healthy
   */
  isHealthy(): boolean {
    if (!this.isRunning || this.connectionState !== "connected") {
      return false;
    }

    // Check last heartbeat
    if (this.lastHeartbeatResponse) {
      const timeSinceHeartbeat = Date.now() - this.lastHeartbeatResponse.getTime();
      if (timeSinceHeartbeat > this.reconnectConfig.heartbeatTimeoutMs * 2) {
        return false;
      }
    }

    return true;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a tracker from token data
 */
export async function createTrackerFromMint(
  tokenMint: string,
  options?: Partial<TrackerConfig>
): Promise<WebSocketTracker> {
  const { PublicKey: SolanaPublicKey } = await import("@solana/web3.js");
  const { PUMP_PROGRAM_ID } = await import("./helius");

  // Derive bonding curve vault PDA
  const mintPubkey = new SolanaPublicKey(tokenMint);
  const programId = new SolanaPublicKey(PUMP_PROGRAM_ID);

  const [bcVault] = SolanaPublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
    programId
  );

  return new WebSocketTracker({
    tokenMint,
    bcVault: bcVault.toBase58(),
    creatorWallet: options?.creatorWallet || "",
    ...options,
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

export { DEFAULT_RECONNECT_CONFIG };
