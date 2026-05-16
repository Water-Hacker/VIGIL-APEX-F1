import { Socket } from 'node:net';

import { createLogger, polygonAnchorSuccess, type Logger } from '@vigil/observability';
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
    // Tier-40 audit closure: client-side input validation mirroring the
    // T15 on-chain VIGILAnchor.sol guards. Reaching the signer (a
    // YubiKey-touched ECDSA sign) and the chain only to revert on
    // contract-side `InvalidRange` / `NonContiguous` / `EmptyRoot` is
    // wasted gas + wasted YubiKey touch + a confusing operator
    // experience. Reject obviously-bad input at the boundary.
    if (!Number.isInteger(fromSeq) || fromSeq < 1) {
      throw new Errors.AuditChainError({
        code: 'POLYGON_BAD_FROM_SEQ',
        message: `fromSeq must be a positive integer (got ${fromSeq})`,
        severity: 'error',
      });
    }
    if (!Number.isInteger(toSeq) || toSeq < fromSeq) {
      throw new Errors.AuditChainError({
        code: 'POLYGON_BAD_SEQ_RANGE',
        message: `toSeq must be an integer >= fromSeq (got fromSeq=${fromSeq}, toSeq=${toSeq})`,
        severity: 'error',
      });
    }
    // Tier-40 audit closure: enforce the same precision-ceiling guard as
    // T20 added to HashChain.append. Once seq > 2^53 the JS Number
    // representation loses precision; the ABI encoder would broadcast
    // the rounded value to the chain and the on-chain commitment would
    // record a different seq than the off-chain audit-chain row.
    if (toSeq > Number.MAX_SAFE_INTEGER) {
      throw new Errors.AuditChainError({
        code: 'POLYGON_SEQ_PRECISION_CEILING',
        message: `toSeq ${toSeq} exceeds Number.MAX_SAFE_INTEGER; canonical-v2 migration required before further anchoring`,
        severity: 'fatal',
      });
    }
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
    const n = (await this.contract.getFunction('totalCommitments').staticCall()) as bigint;
    return Number(n);
  }

  async getCommitment(id: number): Promise<{
    fromSeq: number;
    toSeq: number;
    rootHash: string;
    committer: string;
    timestamp: number;
  }> {
    const r = (await this.contract.getFunction('getCommitment').staticCall(id)) as [
      bigint,
      bigint,
      string,
      string,
      bigint,
    ];
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

  /**
   * NDJSON request/response over the Unix socket. Each request is a
   * single line (`<json>\n`); the response is the first line received.
   * Fragmentation, multi-frame, or trailing data after the first newline
   * is handled correctly — the previous implementation buffered until
   * `end` and could deadlock if the signer kept the socket open after
   * a single response. A 30 s timeout protects against signer hangs.
   */
  private rpc(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock = new Socket();
      let buf = '';
      let done = false;

      const finish = (err: unknown, value?: string): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sock.removeAllListeners();
        sock.destroy();
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(value!);
      };

      const timer = setTimeout(() => {
        finish(new Error(`polygon-signer rpc timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      sock.connect(this.socketPath);
      sock.on('connect', () => {
        sock.write(JSON.stringify({ method, params }) + '\n');
      });
      sock.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        const newlineAt = buf.indexOf('\n');
        if (newlineAt < 0) return; // wait for more bytes
        const line = buf.slice(0, newlineAt);
        try {
          const r = JSON.parse(line) as { ok: true; result: string } | { ok: false; error: string };
          if (r.ok) finish(null, r.result);
          else finish(new Error(r.error));
        } catch (e) {
          finish(e);
        }
      });
      sock.on('end', () => finish(new Error('polygon-signer closed before response')));
      sock.on('error', (e) => finish(e));
    });
  }
}

/** Local-dev signer using a private key in memory. NEVER use in prod. */
export class LocalWalletAdapter implements SignerAdapter {
  private readonly wallet: ethers.Wallet;
  constructor(privateKey: string, provider: ethers.Provider) {
    // Tier-40 audit closure: refuse to construct in NODE_ENV=production.
    // Pre-fix the only safeguard was the "NEVER use in prod" comment,
    // which is unenforceable. A misconfigured local-dev script left
    // running with NODE_ENV=production (or simply imported via the
    // wrong barrel by a future worker) would silently hold a plaintext
    // EOA private key in process memory next to the YubiKey-bound
    // production signer — the exact attack surface the unix-socket
    // signer design exists to prevent.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'LocalWalletAdapter refuses to instantiate in NODE_ENV=production; use UnixSocketSignerAdapter against vigil-polygon-signer.service instead',
      );
    }
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
