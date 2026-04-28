import { makeSectoralAdapter } from './_sectoral-ministry.js';

makeSectoralAdapter({
  sourceId: 'mintp-public-works',
  baseUrl: 'https://www.mintp.cm',
  listingPaths: ['/marches-publics', '/avis-d-attribution', '/avis-d-appel-d-offres'],
});
