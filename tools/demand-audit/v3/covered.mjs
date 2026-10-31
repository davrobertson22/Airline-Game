// @not-a-test — which countries each v3 source covers in full (its own
// statistics, every route in every direction), shared by the v3 fits.
export const COVERED = {
  eurostat: ['AT','BE','BG','CH','CY','DE','DK','EE','GR','ES','FI','FR','HR','HU','IE','IS','IT','LT','LU','LV','ME','MK','MT','NL','NO','PL','PT','RO','RS','SE','SI','SK','TR'],
  caa: ['GB'], bts_t100i: ['US'], bitre_city_pairs: ['AU'], t100_domestic: ['US'], bitre_domestic: ['AU'],
  anac_br: ['BR'], afac_mx: ['MX'],
  UK_CAA_DOM: ['GB'], UK_CAA_INTL: ['GB'], IN_DGCA_DOM_FY: ['IN'], IN_DGCA_INTL: ['IN'], JP_MLIT_DOM_SEG: ['JP'],
};
// Countries whose source covers DOMESTIC routes only (MLIT publishes no
// international airport pairs): their airport factors are fitted on, and
// apply to, domestic pairs only. Mirrors DOMESTIC_FACTOR_COUNTRIES in market.js.
export const DOMESTIC_ONLY = new Set(['JP']);
export const COVERED_COUNTRIES = (sources) => new Set(sources.flatMap((s) => COVERED[s] ?? []));
