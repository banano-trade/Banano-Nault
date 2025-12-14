import { Injectable } from '@angular/core';
import * as url from 'url';
import { TranslocoService, getBrowserCultureLang, getBrowserLang } from '@ngneat/transloco';

export type WalletStore = 'localStorage'|'none';
export type PoWSource = 'server'|'clientCPU'|'clientWebGL'|'best'|'custom';
export type LedgerConnectionType = 'usb'|'bluetooth';

interface AppSettings {
  language: string;
  displayDenomination: string;
  // displayPrefix: string | null;
  walletStore: string;
  displayCurrency: string;
  defaultRepresentative: string | null;
  bnsEnabled: boolean;
  bnsBanTldAccount: string;
  lockOnClose: number;
  lockInactivityMinutes: number;
  ledgerReconnect: LedgerConnectionType;
  powSource: PoWSource;
  multiplierSource: number;
  customWorkServer: string;
  pendingOption: string;
  decentralizedAliasesOption: string;
  serverName: string;
  serverAPI: string | null;
  serverWS: string | null;
  serverAuth: string | null;
  minimumReceive: string | null;
  walletVersion: number | null;
  lightModeEnabled: boolean;
  identiconsStyle: string;
}

@Injectable()
export class AppSettingsService {
  storeKey = `banvault-appsettings`;

  settings: AppSettings = {
    language: null,
    displayDenomination: 'mban',
    // displayPrefix: 'xrb',
    walletStore: 'localStorage',
    displayCurrency: 'USD',
    defaultRepresentative: 'ban_1hootubxy68fhhrctjmaias148tz91tsse3pq1pgmfedsm3cubhobuihqnxd',
    bnsEnabled: true,
    bnsBanTldAccount: 'ban_1fdo6b4bqm6pp1w55duuqw5ebz455975o4qcp8of85fjcdw9qhuzxsd3tjb9',
    lockOnClose: 1,
    lockInactivityMinutes: 30,
    ledgerReconnect: 'usb',
    powSource: 'best',
    multiplierSource: 1,
    customWorkServer: '',
    pendingOption: 'amount',
    decentralizedAliasesOption: 'disabled',
    serverName: 'banano-trade',
    serverAPI: null,
    serverWS: null,
    serverAuth: null,
    minimumReceive: '0.000001',
    walletVersion: 1,
    lightModeEnabled: false,
    identiconsStyle: 'monkey',
  };

  serverOptions = [
    {
      name: 'Random',
      value: 'random',
      api: null,
      ws: null,
      auth: null,
      shouldRandom: false,
    },
    {
      name: 'Banano Trade',
      value: 'banano-trade',
      api: 'https://api.banano.trade/proxy',
      ws: 'wss://ws.banano.trade',
      auth: null,
      shouldRandom: true,
    },
    {
      name: 'Banano Booster',
      value: 'banano-booster',
      api: 'https://booster.dev-ptera.com/banano-rpc',
      ws: 'wss://ws.banano.trade',
      auth: null,
      shouldRandom: true,
    },
    {
      name: 'Kalium',
      value: 'kalium',
      api: 'https://kaliumapi.appditto.com/api',
      ws: 'wss://ws.banano.trade',
      auth: null,
      shouldRandom: true,
    },
    {
      name: 'JungleTV',
      value: 'jungletv',
      api: 'https://public.node.jungletv.live/rpc',
      ws: 'wss://ws.banano.trade',
      auth: null,
      shouldRandom: false,
    },
    {
      name: 'Custom',
      value: 'custom',
      api: null,
      ws: null,
      auth: null,
      shouldRandom: false,
    },
    {
      name: 'Offline Mode',
      value: 'offline',
      api: null,
      ws: null,
      auth: null,
      shouldRandom: false,
    }
  ];

  // Simplified list for comparison in other classes
  knownApiEndpoints = this.serverOptions.reduce((acc, server) => {
    if (!server.api) return acc;
    acc.push( server.api.replace(/https?:\/\//g, '') );
    return acc;
  }, [
    'api.banano.trade'
  ]);

  constructor(
    private translate: TranslocoService
  ) { }

  loadAppSettings() {
    let settings: AppSettings = this.settings;
    const settingsStore = localStorage.getItem(this.storeKey) || localStorage.getItem('nanovault-appsettings');
    if (settingsStore) {
      settings = JSON.parse(settingsStore);
      // migrate old key to new namespace
      localStorage.setItem(this.storeKey, settingsStore);
    }

    // Migrate legacy websocket endpoints to current one
    if (settings.serverWS && settings.serverWS.indexOf('ws2.banano.trade') !== -1) {
      settings.serverWS = settings.serverWS.replace('ws2.banano.trade', 'ws.banano.trade');
    }

    this.settings = Object.assign(this.settings, settings);

    if (this.settings.language === null) {
      const browserCultureLang = getBrowserCultureLang();
      const browserLang = getBrowserLang();

      if (this.translate.getAvailableLangs().some(lang => lang['id'] === browserCultureLang)) {
        this.settings.language = browserCultureLang;
      } else if (this.translate.getAvailableLangs().some(lang => lang['id'] === browserCultureLang)) {
        this.settings.language = browserLang;
      } else {
        this.settings.language = this.translate.getDefaultLang();
      }

      console.log('No language configured, setting to: ' + this.settings.language);
      console.log('Browser culture language: ' + browserCultureLang);
      console.log('Browser language: ' + browserLang);
    }

    this.loadServerSettings();

    return this.settings;
  }

  loadServerSettings() {
    const matchingServerOption = this.serverOptions.find(d => d.value === this.settings.serverName);

    if (this.settings.serverName === 'random' || !matchingServerOption) {
      const availableServers = this.serverOptions.filter(server => server.shouldRandom);
      const randomServerOption = availableServers[Math.floor(Math.random() * availableServers.length)];
      console.log('SETTINGS: Random', randomServerOption);

      this.settings.serverAPI = randomServerOption.api;
      this.settings.serverWS = randomServerOption.ws;
      this.settings.serverName = 'random';
    } else if (this.settings.serverName === 'custom') {
      console.log('SETTINGS: Custom');
    } else if (this.settings.serverName === 'offline') {
      console.log('SETTINGS: Offline Mode');
      this.settings.serverName = matchingServerOption.value;
      this.settings.serverAPI = matchingServerOption.api;
      this.settings.serverWS = matchingServerOption.ws;
    } else {
      console.log('SETTINGS: Found', matchingServerOption);
      this.settings.serverName = matchingServerOption.value;
      this.settings.serverAPI = matchingServerOption.api;
      this.settings.serverWS = matchingServerOption.ws;
    }
  }

  saveAppSettings() {
    localStorage.setItem(this.storeKey, JSON.stringify(this.settings));
  }

  getAppSetting(key) {
    return this.settings[key] || null;
  }

  setAppSetting(key, value) {
    this.settings[key] = value;
    this.saveAppSettings();
  }

  setAppSettings(settingsObject) {
    for (const key in settingsObject) {
      if (!settingsObject.hasOwnProperty(key)) continue;
      this.settings[key] = settingsObject[key];
    }

    this.saveAppSettings();
  }

  clearAppSettings() {
    localStorage.removeItem(this.storeKey);
    this.settings = {
      language: 'en',
      displayDenomination: 'mban',
      // displayPrefix: 'xrb',
      walletStore: 'localStorage',
      displayCurrency: 'USD',
      defaultRepresentative: 'ban_1hootubxy68fhhrctjmaias148tz91tsse3pq1pgmfedsm3cubhobuihqnxd',
      bnsEnabled: true,
      bnsBanTldAccount: 'ban_1fdo6b4bqm6pp1w55duuqw5ebz455975o4qcp8of85fjcdw9qhuzxsd3tjb9',
      lockOnClose: 1,
      lockInactivityMinutes: 30,
      ledgerReconnect: 'usb',
      powSource: 'best',
      multiplierSource: 1,
      customWorkServer: '',
      pendingOption: 'amount',
      decentralizedAliasesOption: 'disabled',
      serverName: 'random',
      serverAPI: null,
      serverWS: null,
      serverAuth: null,
      minimumReceive: '0.000001',
      walletVersion: 1,
      lightModeEnabled: false,
      identiconsStyle: 'monkey',
    };
  }

  // Get the base URL part of the serverAPI, e.g. https://nanovault.io from https://nanovault.io/api/node-api.
  getServerApiBaseUrl(): string {
    const u = url.parse(this.settings.serverAPI);
    u.pathname = '/';
    return url.format(u);
  }
}
