import { Injectable } from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {BaseApiAccount, WalletApiAccount, WalletService} from './wallet.service';
import BigNumber from 'bignumber.js';
import {ApiService} from './api.service';
import {UtilService} from './util.service';
import { NinjaService } from './ninja.service';

export interface RepresentativeStatus {
  online: boolean;
  veryHighWeight: boolean;
  highWeight: boolean;
  veryLowUptime: boolean;
  lowUptime: boolean;
  closing: boolean;
  markedToAvoid: boolean;
  markedAsNF: boolean;
  trusted: boolean;
  changeRequired: boolean;
  warn: boolean;
  known: boolean;
  daysSinceLastVoted: number;
  uptime: number;
  score: number;
}

export interface RepresentativeOverview {
  id: string;
  weight: BigNumber;
  accounts: WalletApiAccount[];
}

export interface StoredRepresentative {
 id: string;
 name: string;
 warn?: boolean;
 trusted?: boolean;
}


export interface RepresentativeApiOverview extends BaseApiAccount {
  account: string;
  accounts: WalletApiAccount[];
  delegatedWeight: BigNumber;
}

export interface FullRepresentativeOverview extends RepresentativeApiOverview {
  id: string;
  percent: BigNumber;
  statusText: string;
  label: string|null;
  status: RepresentativeStatus;
  donationAddress?: string;
}


@Injectable()
export class RepresentativeService {
  storeKey = `banvault-representatives`;

  representatives$ = new BehaviorSubject([]);
  representatives = [];

  walletReps$ = new BehaviorSubject([null]);
  walletReps = [];

  changeableReps$ = new BehaviorSubject([]);
  changeableReps = [];

  onlineStakeTotal = new BigNumber(115202418);

  loaded = false;

  constructor(
    private wallet: WalletService,
    private api: ApiService,
    private util: UtilService,
    private ninja: NinjaService
  ) {
    this.representatives = this.defaultRepresentatives;
    this.tryUpdateRepresentativesFromCreeper();
  }

  /**
   * Determine if any accounts in the wallet need a rep change
   * @returns {Promise<FullRepresentativeOverview[]>}
   */
  async detectChangeableReps(cachedReps?: FullRepresentativeOverview[]): Promise<FullRepresentativeOverview[]> {
    const representatives = cachedReps ? cachedReps : await this.getRepresentativesOverview();

    // Now based on some of their properties, we filter them out
    const needsChange = [];
    for (const rep of representatives) {
      if (rep.status.trusted) {
        continue; // Reps marked as trusted are good no matter their status
      }

      // If we have high weight, low uptime or marked as warn, then we need to change
      if (
            rep.status.highWeight
          || rep.status.veryHighWeight
          || rep.status.lowUptime
          || rep.status.veryLowUptime
          || rep.status.warn
        ) {
          needsChange.push(rep);
      }
    }

    this.changeableReps = needsChange;
    this.changeableReps$.next(needsChange);

    return needsChange;
  }

  /**
   * Get a detailed overview of representatives for all acounts in the wallet
   * @returns {Promise<FullRepresentativeOverview[]>}
   */
  async getRepresentativesOverview(): Promise<FullRepresentativeOverview[]> {
    // First get the details of all representatives for accounts in our wallet
    const accounts = await this.wallet.getAccountsDetails();
    const uniqueReps = this.getUniqueRepresentatives(accounts);
    const representatives = await this.getRepresentativesDetails(uniqueReps);
    const onlineReps = await this.getOnlineRepresentatives();
    const quorum = await this.api.confirmationQuorum();

    const online_stake_total = (quorum && quorum.online_stake_total) ? this.util.nano.rawToMnano(quorum.online_stake_total) : null;
    this.onlineStakeTotal = online_stake_total ? new BigNumber(online_stake_total) : new BigNumber(0);

    const allReps = [];

    // Now, loop through each representative and determine some details about it
    for (const representative of representatives) {
      const repOnline = onlineReps.indexOf(representative.account) !== -1;
      const knownRep = this.getRepresentative(representative.account);
      const knownRepNinja = await this.ninja.getAccount(representative.account);

      const nanoWeight = this.util.nano.rawToMnano(representative.weight || 0);
      const percent = this.onlineStakeTotal ? nanoWeight.div(this.onlineStakeTotal).times(100) : new BigNumber(0);

      const repStatus: RepresentativeStatus = {
        online: repOnline,
        veryHighWeight: false,
        highWeight: false,
        veryLowUptime: false,
        lowUptime: false,
        closing: false,
        markedToAvoid: false,
        markedAsNF: false,
        trusted: false,
        daysSinceLastVoted: 0,
        changeRequired: false,
        warn: false,
        known: false,
        uptime: null,
        score: null
      };

      // Determine the status based on some factors
      let status = 'none';
      let label;

      if (percent.gte(10)) {
        status = 'alert'; // Has extremely high voting weight
        repStatus.veryHighWeight = true;
        repStatus.changeRequired = true;
      } else if (percent.gte(5)) {
        status = 'warn'; // Has high voting weight
        repStatus.highWeight = true;
      }

      // Check hardcoded NF reps (override below if trusted but leave markedAsNF intact)
      const nf = this.nfReps.find(bad => bad.id === representative.account);
      if (nf) {
        repStatus.markedAsNF = true;
        repStatus.changeRequired = true;
        repStatus.warn = true;
        status = 'alert';
      }

      if (knownRep) {
        // in the list of known representatives
        status = status === 'none' ? 'ok' : status;
        label = knownRep.name;
        repStatus.known = true;
        if (knownRep.trusted) {
          status = 'trusted'; // marked as trusted
          repStatus.trusted = true;
          repStatus.changeRequired = false;
          repStatus.warn = false;
        }
        if (knownRep.warn) {
          status = 'alert'; // marked to avoid
          repStatus.markedToAvoid = true;
          repStatus.warn = true;
          repStatus.changeRequired = true;
        }
      } else if (knownRepNinja) {
        status = status === 'none' ? 'ok' : status;
        label = knownRepNinja.alias;
      }

      const uptimeIntervalDays = 7;

      if (knownRepNinja && !repStatus.trusted) {
        if (knownRepNinja.closing === true) {
          status = 'alert';
          repStatus.closing = true;
          repStatus.warn = true;
          repStatus.changeRequired = true;
        }

        let uptimeIntervalValue = knownRepNinja.uptime_over.week;

        // temporary fix for knownRepNinja.uptime_over.week always returning 0
        // uptimeIntervalValue = knownRepNinja.uptime_over.month;
        // uptimeIntervalDays = 30;
        // /temporary fix

        // consider uptime value at least 1/<interval days> of daily uptime
        uptimeIntervalValue = Math.max(
          uptimeIntervalValue,
          (knownRepNinja.uptime_over.day / uptimeIntervalDays)
        );

        if (repOnline === true) {
          // consider uptime value at least 1% if the rep is currently online
          uptimeIntervalValue = Math.max(uptimeIntervalValue, 1);
        }

        repStatus.uptime = uptimeIntervalValue;
        repStatus.score = knownRepNinja.score;

        const msSinceLastVoted = knownRepNinja.lastVoted ? ( Date.now() - new Date(knownRepNinja.lastVoted).getTime() ) : 0;
        repStatus.daysSinceLastVoted = Math.floor(msSinceLastVoted / 86400000);
        if (uptimeIntervalValue === 0) {
          // display a minimum of <interval days> if the uptime value is 0%
          repStatus.daysSinceLastVoted = Math.max(repStatus.daysSinceLastVoted, uptimeIntervalDays);
        }

        if (uptimeIntervalValue < 50) {
          status = 'alert';
          repStatus.veryLowUptime = true;
          repStatus.warn = true;
          repStatus.changeRequired = true;
        } else if (uptimeIntervalValue < 60) {
          if (status !== 'alert') {
            status = 'warn';
          }
          repStatus.lowUptime = true;
          repStatus.warn = true;
        }
      } else if (knownRepNinja === false) {
        // does not exist (404)
        status = 'alert';
        repStatus.uptime = 0;
        repStatus.veryLowUptime = true;
        repStatus.daysSinceLastVoted = uptimeIntervalDays;
        repStatus.warn = true;
        repStatus.changeRequired = true;
      } else {
        // any other api error
        status = status === 'none' ? 'unknown' : status;
      }

      const additionalData = {
        id: representative.account,
        percent: percent,
        statusText: status,
        label: label,
        status: repStatus,
        donationAddress: knownRepNinja?.donation?.account,
      };

      const fullRep = { ...representative, ...additionalData };
      allReps.push(fullRep);
    }

    this.walletReps = allReps;
    this.walletReps$.next(allReps);

    return allReps;
  }

  /**
   * Build a list of unique representatives based on the accounts provided
   * Many accounts may share the same representative
   * @param accounts
   * @returns {RepresentativeOverview[]}
   */
  getUniqueRepresentatives(accounts: WalletApiAccount[]): RepresentativeOverview[] {
    const representatives = [];
    for (const account of accounts) {
      if (!account || !account.representative) continue; // Account doesn't exist yet

      const existingRep = representatives.find(rep => rep.id === account.representative);
      if (existingRep) {
        existingRep.weight = existingRep.weight.plus(new BigNumber(account.balance));
        existingRep.accounts.push(account);
      } else {
        const newRep = {
          id: account.representative,
          weight: new BigNumber(account.balance),
          accounts: [account],
        };
        representatives.push(newRep);
      }
    }

    return representatives;
  }

  /**
   * Get a list of all online representatives
   * @returns {Promise<string[]>}
   */
  async getOnlineRepresentatives(): Promise<string[]> {
    const representatives = [];

    const creeperReps = await this.getCreeperRepresentatives();
    if (Array.isArray(creeperReps) && creeperReps.length) {
      const online = creeperReps
        .filter(rep => rep?.online)
        .map(rep => this.util.account.normalizeAccount(rep.address, 'ban'))
        .filter(acc => this.util.account.isValidAccount(acc));
      if (online.length) {
        return online;
      }
    }

    const reps = await this.api.representativesOnline();
    if (!reps) return representatives;
    for (const representative in reps.representatives) {
      if (!reps.representatives.hasOwnProperty(representative)) continue;
      representatives.push(reps.representatives[representative]);
    }

    return representatives;
  }

  /**
   * Add detailed API information to each representative
   * Note: The uglyness allows for requests to run in parallel
   * @param {RepresentativeOverview[]} representatives
   * @returns {Promise<RepresentativeApiOverview[]>}
   */
  async getRepresentativesDetails(representatives: RepresentativeOverview[]): Promise<RepresentativeApiOverview[]> {
    const repInfos = await Promise.all(
      representatives.map(rep =>
        this.api.accountInfo(rep.id)
          .then((res: RepresentativeApiOverview) => {
            res.account = rep.id;
            res.delegatedWeight = rep.weight;
            res.accounts = rep.accounts;

            return res;
          })
      )
    );

    return repInfos;
  }

  /**
   * Load the stored/known representative list from local storage
   * @returns {StoredRepresentative[]}
   */
  loadRepresentativeList(): StoredRepresentative[] {
    if (this.loaded) return this.representatives;

    let list = this.defaultRepresentatives;
    const representativeStore = localStorage.getItem(this.storeKey) || localStorage.getItem('nanovault-representatives');
    if (representativeStore) {
      list = JSON.parse(representativeStore);
      localStorage.setItem(this.storeKey, representativeStore);
      localStorage.removeItem('nanovault-representatives');
    }
    this.representatives = list;
    this.representatives$.next(list);
    this.loaded = true;

    if (!representativeStore) {
      this.tryUpdateRepresentativesFromCreeper();
    }

    return list;
  }

  patchXrbPrefixData() {
    const representativeStore = localStorage.getItem(this.storeKey);
    if (!representativeStore) return;

    const list = JSON.parse(representativeStore);

    const newRepList = list.map(entry => {
      const id = (entry.id || '').replace(/^(xrb|nano)_/i, 'ban_');
      return { ...entry, id };
    });

    localStorage.setItem(this.storeKey, JSON.stringify(newRepList));

    return true;
  }

  getRepresentative(id): StoredRepresentative | undefined {
    return this.representatives.find(rep => rep.id === id);
  }

  // Reset representatives list to the default one
  resetRepresentativeList() {
    localStorage.removeItem(this.storeKey);
    this.representatives = this.defaultRepresentatives;
    this.loaded = false;
  }


  saveRepresentative(accountID, name, trusted = false, warn = false): void {
    const newRepresentative: any = {
      id: accountID,
      name: name,
    };
    if (trusted) newRepresentative.trusted = true;
    if (warn) newRepresentative.warn = true;

    const existingRepresentative = this.representatives.find(
      r => r.name.toLowerCase() === name.toLowerCase() || r.id.toLowerCase() === accountID.toLowerCase()
    );
    if (existingRepresentative) {
      this.representatives.splice(this.representatives.indexOf(existingRepresentative), 1, newRepresentative);
    } else {
      this.representatives.push(newRepresentative);
    }

    this.saveRepresentatives();
    this.representatives$.next(this.representatives);
  }

  deleteRepresentative(accountID): void {
    const existingIndex = this.representatives.findIndex(a => a.id.toLowerCase() === accountID.toLowerCase());
    if (existingIndex === -1) return;

    this.representatives.splice(existingIndex, 1);

    this.saveRepresentatives();
    this.representatives$.next(this.representatives);
  }

  saveRepresentatives(): void {
    localStorage.setItem(this.storeKey, JSON.stringify(this.representatives));
  }

  getSortedRepresentatives() {
    const weightedReps = this.representatives.map(r => {
      if (r.trusted) {
        r.weight = 2;
      } else if (r.warn) {
        r.weight = 0;
      } else {
        r.weight = 1;
      }
      return r;
    });

    return weightedReps.sort((a, b) => b.weight - a.weight);
  }

  nameExists(name: string): boolean {
    return this.representatives.findIndex(a => a.name.toLowerCase() === name.toLowerCase()) !== -1;
  }

  // Default representatives list
  // eslint-disable-next-line @typescript-eslint/member-ordering
  defaultRepresentatives: StoredRepresentative[] = [
    { id: 'ban_1hootubxy68fhhrctjmaias148tz91tsse3pq1pgmfedsm3cubhobuihqnxd', name: 'ban_1hoot...hqnxd', trusted: true },
    { id: 'ban_1bananobh5rat99qfgt1ptpieie5swmoth87thi74qgbfrij7dcgjiij94xr', name: 'ban_1banan...94xr', trusted: true },
    { id: 'ban_1ka1ium4pfue3uxtntqsrib8mumxgazsjf58gidh1xeo5te3whsq8z476goo', name: 'ban_1ka1i...6goo', trusted: true },
    { id: 'ban_3batmanuenphd7osrez9c45b3uqw9d9u81ne8xa6m43e1py56y9p48ap69zg', name: 'ban_3batm...69zg' },
    { id: 'ban_1banbet1hxxe9aeu11oqss9sxwe814jo9ym8c98653j1chq4k4yaxjsacnhc', name: 'ban_1banb...cnhc' },
    { id: 'ban_1heart7e8u4tnyowup9hwchx8tkfaqjiyp67si74gdanziizegf7p37jd6gf', name: 'ban_1hear...d6gf', trusted: true },
    { id: 'ban_3grayknbwtrjdsbdgsjbx4fzds7eufjqghzu6on57aqxte7fhhh14gxbdz61', name: 'ban_3gray...dz61' },
    { id: 'ban_3pa1m3g79i1h7uijugndjeytpmqbsg6hc19zm8m7foqygwos1mmcqmab91hh', name: 'ban_3pa1m...91hh' },
    { id: 'ban_3tacocatezozswnu8xkh66qa1dbcdujktzmfpdj7ax66wtfrio6h5sxikkep', name: 'ban_3taco...kkep' },
    { id: 'ban_1moonanoj76om1e9gnji5mdfsopnr5ddyi6k3qtcbs8nogyjaa6p8j87sgid', name: 'ban_1moon...sgid' },
    { id: 'ban_1goobcumtuqe37htu4qwtpkxnjj4jjheyz6e6kke3mro7d8zq5d36yskphqt', name: 'ban_1goob...phqt' },
  ];

  // Bad representatives hardcoded to be avoided. Not visible in the user rep list
  // eslint-disable-next-line @typescript-eslint/member-ordering
  nfReps = [];

  private async tryUpdateRepresentativesFromCreeper(minWeight = 100000) {
    const creeperReps = await this.getCreeperRepresentatives(minWeight);
    if (!creeperReps || !creeperReps.length) return;

    const mapped = this.mapCreeperRepsToStored(creeperReps);
    if (!mapped.length) return;

    this.defaultRepresentatives = mapped;

    if (!localStorage.getItem(this.storeKey)) {
      this.representatives = mapped;
      this.representatives$.next(mapped);
    }
  }

  private async getCreeperRepresentatives(minWeight = 100000): Promise<any[] | null> {
    return await this.api.creeperRepresentatives(minWeight, true);
  }

  private mapCreeperRepsToStored(creeperReps: any[]): StoredRepresentative[] {
    return creeperReps
      .map((rep, idx) => {
        const id = this.util.account.normalizeAccount(rep.address || '', 'ban');
        if (!this.util.account.isValidAccount(id)) return null;
        const short = `${id.slice(0, 11)}...${id.slice(-6)}`;
        return {
          id,
          name: short,
          trusted: !!rep.online,
        } as StoredRepresentative;
      })
      .filter((rep): rep is StoredRepresentative => !!rep);
  }

}
