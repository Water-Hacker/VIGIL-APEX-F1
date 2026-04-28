import { makeSectoralAdapter } from './_sectoral-ministry.js';

makeSectoralAdapter({
  sourceId: 'minhdu-housing',
  baseUrl: 'https://www.minhdu.gov.cm',
  listingPaths: ['/marches', '/appels-offres', '/avis-d-attribution'],
});
