import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'rai'
})
export class RaiPipe implements PipeTransform {
  precision = 6;

  mban = 1e29; // 1 BAN
  kban = 1e26; // 0.001 BAN
  ban  = 1e23; // 0.000001 BAN

  transform(value: any, args?: any): any {
    const opts = args.split(',');
    const denomination = opts[0] || 'mban';
    const hideText = opts[1] || false;

    switch (denomination.toLowerCase()) {
      default:
      case 'xrb': return `${(value / this.mban).toFixed(6)}${!hideText ? ' BAN' : ''}`;
      case 'mnano': // legacy aliases
      case 'mban':
        const hasRawValue = (value / this.ban) % 1;
        if (hasRawValue) {
          // New more precise toFixed function, but bugs on huge raw numbers
          const newVal = value / this.mban < 0.000001 ? 0 : value / this.mban;
          return `${this.toFixed(newVal, this.precision)}${!hideText ? ' BAN' : ''}`;
        } else {
          return `${(value / this.mban).toFixed(6)}${!hideText ? ' BAN' : ''}`;
        }
      case 'knano': // legacy aliases
      case 'kban': return `${(value / this.kban).toFixed(3)}${!hideText ? ' kBAN' : ''}`;
      case 'nano': // legacy aliases
      case 'ban': return `${(value / this.ban).toFixed(0)}${!hideText ? ' ban' : ''}`;
      case 'raw': return `${value}${!hideText ? ' raw' : ''}`;
      case 'dynamic':
        const rai = (value / this.ban);
        if (rai >= 1000000) {
          return `${(value / this.mban).toFixed(this.precision)}${!hideText ? ' BAN' : ''}`;
        } else if (rai >= 1000) {
          return `${(value / this.kban).toFixed(this.precision)}${!hideText ? ' kBAN' : ''}`;
        } else if (rai >= 0.00001) {
          return `${(value / this.ban).toFixed(this.precision)}${!hideText ? ' ban' : ''}`;
        } else if (rai === 0) {
          return `${value}${!hideText ? ' BAN' : ''}`;
        } else {
          return `${value}${!hideText ? ' raw' : ''}`;
        }
    }
  }

  toFixed(num, fixed) {
    if (isNaN(num)) {
      return 0;
    }
    const re = new RegExp('^-?\\d+(?:\.\\d{0,' + (fixed || -1) + '})?');
    return num.toString().match(re)[0];
  }

}
