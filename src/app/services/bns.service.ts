import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class BnsService {
  private scriptLoaded = false;
  private loadingPromise: Promise<void> | null = null;
  private readonly scriptUrl = 'https://cdn.banano.trade/bns-browser.js';
  private readonly fallbackRpcEndpoints = [
    'https://api.banano.trade/proxy',
    'https://kaliumapi.appditto.com/api',
    'https://booster.dev-ptera.com/banano-rpc',
  ];

  private async ensureScript(): Promise<void> {
    if (this.scriptLoaded) {
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = new Promise((resolve, reject) => {
      // Avoid adding the script twice
      const existing = document.querySelector(`script[src="${this.scriptUrl}"]`);
      if (existing) {
        existing.addEventListener('load', () => {
          this.scriptLoaded = true;
          resolve();
        });
        existing.addEventListener('error', () => reject(new Error('Failed loading BNS script')));
        return;
      }

      const script = document.createElement('script');
      script.src = this.scriptUrl;
      script.async = true;
      script.onload = () => {
        this.scriptLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed loading BNS script'));
      document.body.appendChild(script);
    });

    return this.loadingPromise;
  }

  /**
   * Resolve a foo.ban style name into a Banano address.
   * @param nameWithSuffix Full name like foo.ban
   * @param tldAccount Account that issues the .ban domains
   * @param rpcUrl RPC endpoint to use
   */
  async resolveBanName(nameWithSuffix: string, tldAccount: string, rpcUrl: string): Promise<string | null> {
    await this.ensureScript();

    const bns = (window as any).bns;
    if (!bns?.Resolver || !(bns?.banani?.RPC || bns?.RPC)) {
      throw new Error('BNS library unavailable');
    }

    const nameOnly = nameWithSuffix.toLowerCase().replace(/\.ban$/, '');

    const endpoints = [rpcUrl, ...this.fallbackRpcEndpoints].filter(Boolean);

    for (const endpoint of endpoints) {
      try {
        const RpcCtor = bns.banani?.RPC || bns.RPC;
        const rpc = new RpcCtor(endpoint, true);
        if (rpc.DECIMALS === undefined) {
          rpc.DECIMALS = 29;
        }
        const resolver = new bns.Resolver(rpc, { ban: tldAccount }, 100);
        const resolved = await resolver.resolve(nameOnly, 'ban', 500);
        if (resolved?.resolved_address) {
          return resolved.resolved_address;
        }
      } catch {
        // try next endpoint
      }
    }

    return null;
  }
}
