import {
  createLogger,
  polygonAnchorSuccess,
  type Logger,
} from '@vigil/observability';
import { Errors } from '@vigil/shared';
import { ethers } from 'ethers';

/**
 * PolygonAnchor — submits hash-chain roots to VIGILAnchor.sol on Polygon mainnet.
 *
 * The wallet's private key NEVER leaves the YubiKey (host service:
 * `vigil-polygon-signer`, SRD §17.7). This module talks to that service over
 * the Unix socket at /run/vigil/polygon-signer.sock — it never holds a key
 * directly. For local dev / tests, a `LocalWalletAdapter` is provided.
 */

const VIGIL_ANCHOR_ABI = [
  // Append-only commit registry
  'function commit(uint256 fromSeq, uint256 toSeq, bytes32 rootHash) external',
  'function getCommitment(uint256 commitmentId) view returns (uint256 fromSeq, uint256 toSeq, bytes32 rootHash, address committer, uint256 timestamp)',
  'function totalCommitments() view returns (uint256)',
  'event Anchored(uint256 indexed commitmentId, uint256 fromSeq, uint256 toSeq, bytes32 rootHash, address indexed committer)',
] as const;

export interface SignerAdapter {
  /** Sign + broadcast a transaction. Returns the tx hash. */
  sendTransaction(tx: ethers.TransactionRequest): Promise<string>;
  getAddress(): Promise<string>;
}

export interface PolygonAnchorOptions {
  readonly rpcUrl: string;
  readonly fallbackRpcUrls?: readonly string[];
  readonly contractAddress: string;
  readonly signer: SignerAdapter;
  readonly chainId?: number;
  readonly maxGasPriceGwei?: number;
  readonly logger?: Logger;
}

export class PolygonAnchor {
  private readonly provider: ethers.FallbackProvider;
  private readonly contract: ethers.Contract;
  private readonly logger: Logger;
  private readonly maxGasPriceGwei: number;

  constructor(private readonly opts: PolygonAnchorOptions) {
    this.logger = opts.logger ?? createLogger({ service: 'polygon-anchor' });
    this.maxGasPriceGwei = opts.maxGasPriceGwei ?? 200;

    const urls = [opts.rpcUrl, ...(opts.fallbackRpcUrls ?? [])];
    const providers = urls.map((u, i) => ({
      provider: new ethers.JsonRpcProvider(u, opts.chainId ?? 137),
      priority: i + 1,
      stallTimeout: 5_000,
      weight: 1,
    }));
    this.provider = new ethers.FallbackProvider(providers, opts.chainId ?? 137);
    this.contract = new ethers.Contract(opts.contractAddress, VIGIL_ANCHOR_ABI, this.provider);
  }

  /**
   * Commit a hash-chain root to VIGILAnchor.
   *
   * @returns the Polygon transaction hash
   */
  async commit(fromSeq: number, toSeq: number, rootHashHex: string): Promise<string> {
    if (!/^[0-9a-f]{64}$/i.test(rootHashHex)) {
      throw new Errors.AuditChainError({
        code: 'POLYGON_BAD_ROOT_HASH',
        message: 'rootHash must be 64-hex-char string',
        severity: 'error',
      });
    }

    // Gas-price guard
    const fee = await this.provider.getFeeData();
    const gasPriceGwei = fee.gasPrice ? Number(ethers.formatUnits(fee.gasPrice, 'gwei')) : 0;
    if (gasPriceGwei > this.maxGasPriceGwei) {
      throw new Errors.AuditChainError({
        code: 'POLYGON_GAS_PRICE_HIGH',
        message: `gas price ${gasPriceGwei} gwei exceeds cap ${this.maxGasPriceGwei}`,
        retryable: true,
        severity: 'warn',
      });
    }

    const calldata = this.contract.interface.encodeFunctionData('commit', [
      fromSeq,
      toSeq,
      `0x${rootHashHex}`,
    ]);

    try {
      const txHash = await this.opts.signer.sendTransaction({
        to: this.opts.contractAddress,
        data: calldata,
        chainId: this.opts.chainId ?? 137,
      });
      polygonAnchorSuccess.labels({ outcome: 'ok' }).inc();
      this.logger.info({ fromSeq, toSeq, txHash }, 'polygon-anchor-committed');
      return txHash;
    } catch (e) {
      polygonAnchorSuccess.labels({ outcome: 'failed' }).inc();
      throw new Errors.AuditChainError({
        code: 'POLYGON_COMMIT_FAILED',
        message: 'Polygon commit failed',
        retryable: true,
        severity: 'error',
        cause: e,
      });
    }
  }

  /** Read on-chain commitment count — used for verification. */
  async totalCommitments(): Promise<number> {
    const n = (await this.contract.totalCommitments()) as bigint;
    return Number(n);
  }

  async getCommitment(id: number): Promise<{
    fromSeq: number;
    toSeq: number;
    rootHash: string;
    committer: string;
    timestamp: number;
  }> {
    const r = (await this.contract.getCommitment(id)) as [bigint, bigint, string, string, bigint];
    return {
      fromSeq: Number(r[0]),
      toSeq: Number(r[1]),
      rootHash: r[2].slice(2),
      committer: r[3],
      timestamp: Number(r[4]),
    };
  }
}

/**
 * UnixSocketSignerAdapter — talks to vigil-polygon-signer.service over the
 * Unix socket per SRD §17.7. The signer holds the YubiKey-bound secp256k1
 * key; this adapter never sees it.
 */

import { Socket } from 'node:net';

export class UnixSocketSignerAdapter implements SignerAdapter {
  constructor(
    private readonly socketPath: string = process.env.POLYGON_SIGNER_SOCKET ??
      '/run/vigil/polygon-signer.sock',
  ) {}

  async getAddress(): Promise<string> {
    return this.rpc('get_address', {});
  }

  async sendTransaction(tx: ethers.TransactionRequest): Promise<string> {
    return this.rpc('sign_and_send', {
      to: tx.to,
      data: tx.data,
      value: tx.value?.toString() ?? '0',
      chainId: tx.chainId?.toString() ?? '137',
    });
  }

  private rpc(method: string, params: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock = new Socket();
      const buf: Buffer[] = [];
      sock.connect(this.socketPath);
      sock.on('connect', () => {
        sock.write(JSON.stringify({ method, params }) + '\n');
      });
      sock.on('data', (chunk) => buf.push(chunk));
      sock.on('end', () => {
        try {
          const r = JSON.parse(Buffer.concat(buf).toString('utf8')) as
            | { ok: true; result: string }
            | { ok: false; error: string };
          if (r.ok) resolve(r.result);
          else reject(new Error(r.error));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
      sock.on('error', reject);
    });
  }
}

/** Local-dev signer using a private key in memory. NEVER use in prod. */
export class LocalWalletAdapter implements SignerAdapter {
  private readonly wallet: ethers.Wallet;
  constructor(privateKey: string, provider: ethers.Provider) {
    this.wallet = new ethers.Wallet(privateKey, provider);
  }
  getAddress(): Promise<string> {
    return Promise.resolve(this.wallet.address);
  }
  async sendTransaction(tx: ethers.TransactionRequest): Promise<string> {
    const sent = await this.wallet.sendTransaction(tx);
    return sent.hash;
  }
}
